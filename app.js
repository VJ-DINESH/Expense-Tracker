const express = require("express");
const bodyParser = require('body-parser');
const session = require('express-session');
const mysql = require('mysql');
const multer = require('multer');
const path = require('path');
const pdf = require('html-pdf');


const flash = require('express-flash');
const nodemailer = require('nodemailer');

const app = express();
const port = 3000;

const myMiddleware = (req, res, next) => {
    if (req.session && req.session.loggedin && req.session.user_id && req.session.email ) {
       
        next(); 
    } else {

        res.redirect('/login'); 
    }
};


app.set("view engine", "ejs");
app.set("views", "views");
app.use(express.static("public"));
app.use(flash());

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());


app.use(session({
    secret: 'test',
    resave: false,
    saveUninitialized: false
}));

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "admin",
});

db.connect((err) => {
    if (err) {
        console.error('Error connecting to database:', err);
        return;
    }
    console.log('Connected to database successfully');
});


// Set up multer storage configuration

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/') 
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname)); 
    }
});

const upload = multer({ storage: storage });


app.use(express.static('public'));





app.get("/", (req, res) => {
    if (req.session && req.session.loggedin) {
        res.redirect("/dashboard");
    } else {
        res.redirect("/login");
    }
});

//Dashboard-Page

app.get('/Dashboard', myMiddleware, (req, res) => {
    const user_id = req.session.user_id;

    if (!user_id) {
        return res.status(401).send('User ID is missing in the session.');
    }

    db.query('SELECT username, filename FROM users WHERE id = ?', [user_id], (err, results) => {
        if (err) {
            console.error('Error querying database for user details:', err);
            return res.status(500).send("Internal Server Error");
        }

        if (results.length === 0) {
            return res.status(404).send("User not found");
        }

        const { username, filename } = results[0]; 
        let currentDate = new Date();
        let last8Months = [];
        const monthNames = [
            "January", "February", "March",
            "April", "May", "June", "July",
            "August", "September", "October",
            "November", "December"
        ];

        const calculateTotalIncomeAndSpend = (startDate, endDate, month, year) => {
            return new Promise((resolve, reject) => {
                db.query(
                    'SELECT SUM(amount) AS totalIncome FROM transactions WHERE transaction_type = ? AND user_id = ? AND date BETWEEN ? AND ?',
                    ['Income', user_id, startDate, endDate],
                    (incomeErr, incomeResults) => {
                        if (incomeErr) {
                            console.error("Error calculating total income:", incomeErr);
                            reject(incomeErr);
                            return;
                        }

                        const totalIncome = incomeResults[0].totalIncome || 0;

                        db.query(
                            'SELECT SUM(amount) AS totalSpend FROM transactions WHERE transaction_type = ? AND user_id = ? AND date BETWEEN ? AND ?',
                            ['Spend', user_id, startDate, endDate],
                            (spendErr, spendResults) => {
                                if (spendErr) {
                                    console.error("Error calculating total spend:", spendErr);
                                    reject(spendErr);
                                    return;
                                }

                                const totalSpend = spendResults[0].totalSpend || 0;

                                last8Months.push({
                                    month: monthNames[month],
                                    year: year,
                                    startDate: startDate.toISOString().split('T')[0],
                                    endDate: endDate.toISOString().split('T')[0],
                                    income_amount: totalIncome,
                                    spend_amount: totalSpend
                                });

                                resolve();
                            }
                        );
                    }
                );
            });
        };

        const promises = [];

        for (let i = 0; i < 8; i++) {
            let month = currentDate.getMonth();
            let year = currentDate.getFullYear();
            let startDate = new Date(year, month, 1);
            let endDate = new Date(year, month + 1, 0);
            promises.push(calculateTotalIncomeAndSpend(startDate, endDate, month, year));
            currentDate.setMonth(month - 1);
        }

        Promise.all(promises)
            .then(() => {
                db.query(`
                    SELECT 
                        SUM(CASE 
                            WHEN type = "Cash" AND credit_debit = "Credit" THEN amount
                            WHEN type = "Cash" AND credit_debit = "Debit" THEN -amount
                            ELSE 0
                        END) AS total_cash_amount,
                        SUM(CASE 
                            WHEN type = "Bank" AND credit_debit = "Credit" THEN amount
                            WHEN type = "Bank" AND credit_debit = "Debit" THEN -amount
                            ELSE 0
                        END) AS total_bank_amount
                    FROM transactions
                    WHERE type IN ("Cash", "Bank")
                    AND user_id = ?`, [user_id], (error1, results1) => {
                    if (error1) {
                        console.error('Error querying database for cash and bank amounts:', error1);
                        return res.status(500).send("Internal Server Error");
                    }

                    const totalCashAmount = results1[0].total_cash_amount || 0;
                    const totalBankAmount = results1[0].total_bank_amount || 0;

                    db.query('SELECT SUM(amount) AS total_income_amount FROM transactions WHERE transaction_type = "Income" AND user_id = ?', [user_id], (error2, results2) => {
                        if (error2) {
                            console.error('Error querying database for income amount:', error2);
                            return res.status(500).send("Internal Server Error");
                        }

                        const totalIncomeAmount = results2[0].total_income_amount || 0;

                        db.query('SELECT SUM(amount) AS total_spend_amount FROM transactions WHERE transaction_type = "Spend" AND user_id = ?', [user_id], (error3, results3) => {
                            if (error3) {
                                console.error('Error querying database for spend amount:', error3);
                                return res.status(500).send("Internal Server Error");
                            }

                            const totalSpendAmount = results3[0].total_spend_amount || 0;

                            res.render("Dashboard", { username, fileName: filename, last8Months, totalCashAmount, totalBankAmount, totalIncomeAmount, totalSpendAmount });
                        });
                    });
                });
            })
            .catch((err) => {
                console.error('Error in promise:', err);
                res.status(500).send("Internal Server Error");
            });
    });
});




//Login-Page

app.get('/login', (req, res) => {
    res.render('login');
});

app.post("/login", (req, res) => {
    const { email, password } = req.body;
    db.query(
        "SELECT * FROM users WHERE email = ?", [email],
        (err, results) => {
            if (err) {
                console.error('Error querying database:', err);
                res.status(500).send("Internal Server Error");
                return;
            }

            if (results.length > 0 && results[0].password === password) {
                req.session.loggedin = true;
                req.session.email = email;
                
                req.session.user_id = results[0].id;
                req.session.username = results[0].username;

               
                res.redirect("/Dashboard");
            } else {
                res.render("login", { error: "Incorrect email or password" });
            }
        }
    );
});


//Register-page

app.get('/register', (req, res) => {  
    res.render('register');
});



app.post('/register', (req, res) => {
    const { username, email, password } = req.body;

    db.query('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email, password], (insertErr, insertResults) => {
        if (insertErr) {
            console.error('Error inserting user:', insertErr);
            return res.status(500).send("Internal Server Error");
        }
        console.log("User inserted successfully:", insertResults);
        return res.redirect('/login');
    });
});

// Check email

app.get('/check-email', (req, res) => {
    const { email } = req.query;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; 

    if (!emailRegex.test(email)) { 
        return res.status(400).json({ error: 'Please enter a valid email address' });
    }

   
    db.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
        if (err) {
            console.error('Error checking email:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }

      
        if (results.length > 0) {
            return res.json({ registered: true });
        } else {
            return res.json({ registered: false });
        }
    });
});

//  username is already taken

app.get('/check-username', (req, res) => {
    const { username } = req.query;

   
    db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
        if (err) {
            console.error('Error checking username:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }

       
        if (results.length > 0) {
            return res.json({ taken: true });
        } else {
            return res.json({ taken: false });
        }
    });
});

//check password

app.post('/check-password', (req, res) => {
    const { password, confirmPassword } = req.body;

    
    const passwordRegex = /^(?=.*[0-9])(?=.*[!@#$%^&])[a-zA-Z0-9!@#$%^&]{6,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long and contain at least one symbol and one number' });
    }

    // Check if password and confirm password match
    if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Passwords do not match' });
    }


    return res.status(200).json({ message: 'Password validation successful' });
});




// Profile 

app.get('/profile', myMiddleware, (req, res) => {
    
    const user_id = req.session.user_id;

    const errorMessages = req.flash('error');
    const successMessages = req.flash('success');
    
    
    db.query('SELECT * FROM users WHERE id = ?', [user_id], (err, results) => {
        if (err) {
           
            console.error('Error retrieving user details:', err);
            return res.status(500).send("Internal Server Error");
        }

        
        if (results.length === 0) {
            return res.status(404).send("User not found");
        }

        const user = results[0];

        
        res.render('profile', { 
            id: user.id, 
            username: user.username, 
            email: user.email,
            fileName: user.filename, 
            errorMessages: errorMessages,
             successMessages: successMessages,
            
        });
    });
});


app.post('/profile', myMiddleware, upload.single('profile_photo'), (req, res, next) => {
    // Check if a file was uploaded
    if (!req.file) {

        // Set a flash message
        req.flash('error', 'No file Selected.');

        // Redirect to the profile page
        return res.redirect('/profile');
    }

   
    const fileName = req.file.filename;

    const user_id = req.session.user_id; 
    const username = req.session.username; 
    const email = req.session.email; 

    
    db.query('UPDATE users SET filename = ? WHERE id = ?', [fileName, user_id], (error, results) => {
        if (error) {
            
            console.error('Error executing MySQL query:', error);
            req.flash('error', 'Error updating file name in the database.');
            return res.redirect('/profile');
        }

     
        console.log('File name updated in the database:', fileName);

       
        req.flash('success', 'File uploaded successfully.');
       
        res.redirect('/profile');
    });
});


//Income-page

app.get('/income', myMiddleware, (req, res) => {
    const username = req.session.username;


    const sql = 'SELECT filename FROM users WHERE id = ?'; 
    db.query(sql, [req.session.user_id], (err, result) => {
        if (err) {
            console.error("Error fetching filename from users table:", err);
            return res.status(500).send("Internal Server Error");
        }

        let fileName = '';

        if (result.length > 0 && result[0].filename) {
            fileName = result[0].filename; 
        }

        res.render('income', { username: username, fileName: fileName });
    });
});



app.get('/income-view', myMiddleware, (req, res) => {
    const user_id = req.session.user_id;

    if (!user_id) {
        return res.status(401).send('User ID is missing in the session.');
    }

    
    db.query('SELECT username, filename FROM users WHERE id = ?', [user_id], (usernameErr, usernameResults) => {
        if (usernameErr) {
            console.error('Error retrieving username from database:', usernameErr);
            return res.status(500).send("Internal Server Error");
        }

        if (usernameResults.length === 0) {
            return res.status(404).send("Username not found");
        }

        const { username, filename } = usernameResults[0]; 

       
        db.query('SELECT * FROM transactions WHERE transaction_type = "Income" AND user_id = ?', [user_id], (err, results) => {
            if (err) {
                console.error('Error querying database:', err);
                return res.status(500).send("Internal Server Error");
            }
            
            res.render('income-view', { username: username, data: results, fileName: filename }); 
        });
    });
});





app.post('/income', myMiddleware, (req, res) => {
    const { from_to, date, amount, type, description } = req.body;
    const user_id = req.session.user_id;

    db.query(
        'INSERT INTO transactions (transaction_type, from_to, date, amount, type, credit_debit, description, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['Income', from_to, date, amount, type, 'Credit', description, user_id],
        (insertErr, insertResults) => {
            if (insertErr) {
                console.error("Error inserting income transaction:", insertErr);
                return res.status(500).send("Internal Server Error");
            }
            console.log("Income transaction inserted successfully:", insertResults);

        
            res.redirect('/income-view');
        }
    );
});


app.get('/edit-income/:transactionId', myMiddleware, (req, res) => {
    const transactionId = req.params.transactionId;
    const username = req.session.username;

    
    const sql = 'SELECT filename FROM users WHERE id = ?';
    db.query(sql, [req.session.user_id], (filenameErr, filenameResult) => {
        if (filenameErr) {
            console.error("Error fetching filename from users table:", filenameErr);
            return res.status(500).send("Internal Server Error");
        }

        if (filenameResult.length === 0) {
            console.log("No filename found for user:", req.session.user_id);
            return res.status(404).send("Filename not found");
        }

        const fileName = filenameResult[0].filename;

        console.log("Transaction ID:", transactionId);

        const sqlQuery = 'SELECT * FROM transactions WHERE id = ?';
        db.query(sqlQuery, [transactionId], (err, result) => {
            if (err) {
                console.error("Error fetching income transaction:", err);
                return res.status(500).send("Internal Server Error");
            }

            console.log("Query Result:", result);

            if (result.length === 0) {
                console.log("No transaction found for ID:", transactionId);
                return res.status(404).send("Transaction not found");
            }

            res.render('edit-income', { income_list: result, username, fileName });
        });
    });
});






app.post('/edit-income-submit/:transactionsId',myMiddleware, (req, res) => {
    const editId = req.body.edit_id;
    const fromTo = req.body.from_to;
    const date = req.body.date;
    const amount = req.body.amount;
    const type = req.body.type;
    const description = req.body.description;

    const transactionId = req.params.transactionsId; 

   
    const sql = 'UPDATE `transactions` SET from_to=?, date=?, amount=?, type=?, description=? WHERE id = ?';

    
    db.query(sql, [fromTo, date, amount, type, description, transactionId], (err) => {
        if (err) {
            console.error("Error updating income transaction:", err);
            res.status(500).send("Internal Server Error");
            return;
        }
        console.log("Income transaction updated successfully");
        res.redirect('/income-view');
    });
});


app.get('/delete-income/:transactionId',myMiddleware,(req, res) => {
    const transactionId = req.params.transactionId;
    const sql = 'DELETE FROM transactions WHERE id = ? AND transaction_type = "Income"';

    db.query(sql, [transactionId], (err) => {
        if (err) {
            console.error("Error deleting income transaction:", err);
            res.status(500).send("Internal Server Error");
            return;
        }
        console.log("Income transaction deleted successfully");
        res.redirect('/income-view');
    });
});

//Income-download

app.get('/Income-pdf', (req, res) => {


    const user_id = req.session.user_id;

    if (!user_id) {
        return res.status(401).send('User ID is missing in the session.');
    }



        db.query('SELECT * FROM transactions WHERE transaction_type = "Income" AND user_id = ?', [user_id], (err, results) => {
            if (err) {
                console.error('Error querying database:', err);
                return res.status(500).send("Internal Server Error");
            }
        

            var htmlContent = `
            <html>
            <style>
        table, td, th {
        border: 1px solid;
        padding:4px;
        }

        table {
        width: 100%;
        border-collapse: collapse;
        }
        h2{
            text-align:center;
            color:black;
           
        }
        td{
            text-align:center;
           }
     
        
        </style>
        <br>
        <h2>Income-Details</h2>
            <table class="table table-bordered">
                <tr>
                    <th>S.No</th>
                    <th>Date</th>
                    <th>Amount From</th>
                    <th>Description</th>
                    <th class="text-right">Amount</th>
                    
                </tr>`;


                results.forEach((row, index) => {

                    const dateObj = new Date(row.date);
                    const formattedDate = `${dateObj.getDate()}-${dateObj.getMonth() + 1}-${dateObj.getFullYear()}`;
                
                    htmlContent += `<tr>
                            <td>${index + 1}</td>
                            <td>${formattedDate}</td>
                            <td>${row.from_to}</td>
                            <td>${row.description}</td>
                            <td >${row.amount.toFixed(2)}</td>
                           </tr>`;
                
                  });



                htmlContent += `
            </html>
            `;
          
            
            const options = { 
              format: 'Letter',
              filename: 'example.pdf', 
            };
          
            
            pdf.create(htmlContent, options).toStream((err, stream) => {
              if (err) {
                res.status(500).send('Internal Server Error');
                return;
              }
          
             
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', 'inline; filename="example.pdf"'); 
          
              
              stream.pipe(res);
            
            
        });
    });


    });
  


//Spend-Page

app.get('/spend', myMiddleware, (req, res) => {
    const username = req.session.username;

 
    const sql = 'SELECT fileName FROM users WHERE id = ?'; 
    db.query(sql, [req.session.user_id], (err, result) => {
        if (err) {
            console.error("Error fetching filename from users table:", err);
            return res.status(500).send("Internal Server Error");
        }

        let fileName = ''; 

        
        if (result.length > 0 && result[0].fileName) {
            fileName = result[0].fileName; 
        }

        res.render('spend', { username, fileName });
    });
});

app.get('/spend-view', myMiddleware, (req, res) => {
    const user_id = req.session.user_id;

    if (!user_id) {
        return res.status(401).send('User ID is missing in the session.');
    }

    db.query('SELECT username,fileName FROM users WHERE id = ?', [user_id], (err, userResults) => {
        if (err) {
            console.error('Error querying database:', err);
            return res.status(500).send("Internal Server Error");
        }

        if (userResults.length === 0) {
            return res.status(404).send("User not found");
        }

        const username = userResults[0].username;
        let fileName = ''; 

        
        if (userResults[0].fileName) {
            fileName = userResults[0].fileName;
        }

        db.query('SELECT * FROM transactions WHERE transaction_type = "Spend" AND user_id = ?', [user_id], (err, results) => {
            if (err) {
                console.error('Error querying database:', err);
                return res.status(500).send("Internal Server Error");
            }

            res.render('spend-view', { username, data: results, fileName });
        });
    });
});

app.post('/spend', myMiddleware, (req, res) => {
    const { from_to, date, amount, type, credit_debit, description } = req.body;
    const user_id = req.session.user_id;


    db.query(
        'INSERT INTO transactions (transaction_type, from_to, date, amount, type, credit_debit, description, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['Spend', from_to, date, amount, type, 'Debit', description, user_id],
        (insertErr, insertResults) => {
            if (insertErr) {
                console.error("Error inserting spend transaction:", insertErr);
                return res.status(500).send("Internal Server Error");
            }
            console.log("Spend transaction inserted successfully:", insertResults);

       
            res.redirect('/spend-view');
        }
    );
});





app.get('/edit-spend/:transactionId', myMiddleware, (req, res) => {
    const transactionId = req.params.transactionId;
    const username = req.session.username;

    const sql = 'SELECT * FROM transactions WHERE id = ?';
    db.query(sql, [transactionId], (err, result) => {
        if (err) {
            console.error("Error fetching spend transaction:", err);
            return res.status(500).send("Internal Server Error");
        }

        if (result.length === 0) {
            console.log("No transaction found for ID:", transactionId);
            return res.status(404).send("Transaction not found");
        }

        
        const userId = result[0].user_id;

        
        const sqlQuery = 'SELECT fileName FROM users WHERE id = ?';
        db.query(sqlQuery, [userId], (filenameErr, filenameResult) => {
            if (filenameErr) {
                console.error("Error fetching filename from users table:", filenameErr);
                return res.status(500).send("Internal Server Error");
            }

            let fileName = ''; 

          
            if (filenameResult.length > 0 && filenameResult[0].fileName) {
                fileName = filenameResult[0].fileName; 
            }

            res.render('edit-spend', { spend_list: result, username, fileName });
        });
    });
});




app.post('/edit-spend-submit/:transactionId',myMiddleware, (req, res) => {
    const editId = req.body.edit_id;
    const fromTo = req.body.from_to;
    const date = req.body.date;
    const amount = req.body.amount;
    const type = req.body.type;
    const description = req.body.description;

    const transactionId = req.params.transactionId;

    const sql = 'UPDATE `transactions` SET from_to=?, date=?, amount=?, type=?, description=? WHERE id = ?';


    db.query(sql, [fromTo, date, amount, type, description, transactionId], (err) => {
        if (err) {
            console.error("Error updating spend transaction:", err);
            res.status(500).send("Internal Server Error");
            return;
        }
        console.log("Spend transaction updated successfully");
        res.redirect('/spend-view');
    });
});


app.get('/delete-spend/:transactionId',myMiddleware, (req, res) => {
    const transactionId = req.params.transactionId;
    const sql = 'DELETE FROM transactions WHERE id = ? AND transaction_type = "Spend"';

    db.query(sql, [transactionId], (err) => {
        if (err) {
            console.error("Error deleting spend transaction:", err);
            res.status(500).send("Internal Server Error");
            return;
        }
        console.log("Spend transaction deleted successfully");
        res.redirect('/spend-view'); 
    });
});


//Spend-download

app.get('/Spend-pdf', (req, res) => {


    const user_id = req.session.user_id;

    if (!user_id) {
        return res.status(401).send('User ID is missing in the session.');
    }



    db.query('SELECT * FROM transactions WHERE transaction_type = "Spend" AND user_id = ?', [user_id], (err, results) => {
        if (err) {
            console.error('Error querying database:', err);
            return res.status(500).send("Internal Server Error");
        }

            var htmlContent = `
            <html>

            <style>

        table, td, th {
        border: 1px solid;
        padding:4px;
        }

        table {
        width: 100%;
        border-collapse: collapse;
        }
        h2{
            text-align:center;
            color:black;
           
        }
        td{
            text-align:center;
           }
        
        </style>
        <br>
        <h2>Spend-Details</h2>
            <table class="table table-bordered">
                <tr>
                    <th>S.No</th>
                    <th>Date</th>
                    <th>Amount From</th>
                    <th>Description</th>
                    <th class="text-right">Amount</th>
                    
                </tr>`;


                results.forEach((row, index) => {

                    const dateObj = new Date(row.date);
                    const formattedDate = `${dateObj.getDate()}-${dateObj.getMonth() + 1}-${dateObj.getFullYear()}`;
                
                    htmlContent += `<tr>
                            <td>${index + 1}</td>
                            <td>${formattedDate}</td>
                            <td>${row.from_to}</td>
                            <td>${row.description}</td>
                            <td >${row.amount.toFixed(2)}</td>
                           </tr>`;
                
                  });



                htmlContent += `
            </html>
            `;
          
          
            const options = { 
              format: 'Letter', 
              filename: 'example.pdf', 
            };
          
           
            pdf.create(htmlContent, options).toStream((err, stream) => {
              if (err) {
                res.status(500).send('Internal Server Error');
                return;
              }
          
            
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', 'inline; filename="example.pdf"'); 
          
              
              stream.pipe(res);
            
            
        });
    });


    });  



//Bank-Deposite-Page

app.get('/Bank-Deposite', myMiddleware, (req, res) => {
    const username = req.session.username;

   
    const sql = 'SELECT fileName FROM users WHERE id = ?'; 
    db.query(sql, [req.session.user_id], (err, result) => {
        if (err) {
            console.error("Error fetching filename from users table:", err);
            return res.status(500).send("Internal Server Error");
        }

        let fileName = ''; 

        
        if (result.length > 0 && result[0].fileName) {
            fileName = result[0].fileName; 
        }

        res.render('Bank-Deposite', { username, fileName });
    });
});

app.get('/Bank-Deposite-view', myMiddleware, (req, res) => {
    const user_id = req.session.user_id;

    if (!user_id) {
        return res.status(401).send('User ID is missing in the session.');
    }

    db.query('SELECT * FROM users WHERE id = ?', [user_id], (err, userResult) => {
        if (err) {
            console.error('Error querying database:', err);
            return res.status(500).send("Internal Server Error");
        }

        const username = userResult[0].username;

     
        const sqlQuery = 'SELECT fileName FROM users WHERE id = ?';
        db.query(sqlQuery, [user_id], (filenameErr, filenameResult) => {
            if (filenameErr) {
                console.error("Error fetching filename from users table:", filenameErr);
                return res.status(500).send("Internal Server Error");
            }

            let fileName = ''; 

           
            if (filenameResult.length > 0 && filenameResult[0].fileName) {
                fileName = filenameResult[0].fileName; 
            }

            db.query('SELECT * FROM transactions WHERE transaction_type = "Deposite" AND type = "Bank" AND credit_debit = "Credit" AND user_id = ?', [user_id], (err, results) => {
                if (err) {
                    console.error('Error querying database:', err);
                    return res.status(500).send("Internal Server Error");
                }

                res.render('Bank-Deposite-view', { username, fileName, data: results });
            });
        });
    });
});


app.post('/Bank-Deposite',myMiddleware, (req, res) => {
    const { Date, Amount, Description } = req.body;
    const user_id = req.session.user_id; 


    db.query(
        'INSERT INTO transactions (Transaction_type, from_to, Date, Amount, Type, Credit_debit, Description, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['Deposite', 'Me', Date, Amount, 'Bank', 'Credit', Description, user_id],
        (insertErr1, insertResults1) => {
            if (insertErr1) {
                console.error("Error inserting bank deposit transaction:", insertErr1);
                res.status(500).send("Internal Server Error");
                return;
            }
            console.log("Bank deposit transaction inserted successfully:", insertResults1);

            
            db.query(
                'INSERT INTO transactions (Transaction_type, from_to, Date, Amount, Type, Credit_debit, Description, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                ['Deposite', 'Bank', Date, Amount, 'Cash', 'Debit', Description, user_id],
                (insertErr2, insertResults2) => {
                    if (insertErr2) {
                        console.error("Error inserting cash deposit transaction:", insertErr2);
                        res.status(500).send("Internal Server Error");
                        return;
                    }
                    console.log("Cash deposit transaction inserted successfully:", insertResults2);
                    res.redirect('/Bank-Deposite-view');
                }
            );
        }
    );
});

app.get('/edit-Bank-Deposite/:transactionId', myMiddleware, (req, res) => {
    const transactionId = req.params.transactionId;
    const username = req.session.username;

    
    const sql = 'SELECT fileName FROM users WHERE id = ?'; 
    db.query(sql, [req.session.user_id], (filenameErr, filenameResult) => {
        if (filenameErr) {
            console.error("Error fetching filename from users table:", filenameErr);
            return res.status(500).send("Internal Server Error");
        }

        let fileName = ''; 

      
        if (filenameResult.length > 0 && filenameResult[0].fileName) {
            fileName = filenameResult[0].fileName; 
        }

        console.log("Transaction ID:", transactionId);

        const sqlQuery = 'SELECT * FROM transactions WHERE id = ?';
        db.query(sqlQuery, [transactionId], (err, result) => {
            if (err) {
                console.error("Error fetching Bank-Deposite transaction:", err);
                return res.status(500).send("Internal Server Error");
            }

            console.log("Query Result:", result);

            if (result.length === 0) {
                console.log("No transaction found for ID:", transactionId);
                return res.status(404).send("Transaction not found");
            }

            res.render('edit-Bank-Deposite', { Bank_Deposite_list: result, username, fileName });
        });
    });
});





app.post('/edit-Bank-Deposite-submit/:transactionId',myMiddleware, (req, res) => {
    const editId = req.body.edit_id;
    const date = req.body.date;
    const amount = req.body.amount;
    const description = req.body.description;

    const transactionId = req.params.transactionId; 

   
    const sql = 'UPDATE `transactions` SET date=?, amount=?, description=? WHERE id = ?';

   
    db.query(sql, [date, amount, description, transactionId], (err) => {
        if (err) {
            console.error("Error updating bank deposit transaction:", err);
            res.status(500).send("Internal Server Error");
            return;
        }
        console.log("Bank deposit transaction updated successfully");
        res.redirect('/Bank-Deposite-view');
    });
});



app.get('/delete-Bank-Deposite/:transactionId',myMiddleware, (req, res) => {
    const transactionId = req.params.transactionId;
    const sql = 'DELETE FROM transactions WHERE id = ? AND transaction_type = "Deposite"';

    db.query(sql, [transactionId], (err) => {
        if (err) {
            console.error("Error deleting bank deposit transaction:", err);
            res.status(500).send("Internal Server Error");
            return;
        }
        console.log("Bank deposit transaction deleted successfully");
        res.redirect('/Bank-Deposite-view'); 
    });
});



//Bank-Deposite-download

app.get('/Bank-Deposite-pdf', (req, res) => {


    const user_id = req.session.user_id;

    if (!user_id) {
        return res.status(401).send('User ID is missing in the session.');
    }


db.query('SELECT * FROM transactions WHERE transaction_type = "Deposite" AND type = "Bank" AND credit_debit = "Credit" AND user_id = ?', [user_id], (err, results) => {
            if (err) {
                console.error('Error querying database:', err);
                return res.status(500).send("Internal Server Error");
            }
        

            var htmlContent = `
            <html>

            <style>
        table, td, th {
        border: 1px solid;
        padding:4px;
        }

        table {
        width: 100%;
        border-collapse: collapse;
        }
        h2{
            text-align:center;
            color:black;
           
        }
        .center{
            text-align:center;
            font-weight:none;
        }
        td{
            text-align:center;
           }
        
        </style>
        <br>
        <h2>Bank-Deposit-Details</h2>
            <table>
                <tr>
                    <th>S.No</th>
                    <th>Date</th>
                    <th>Amount From</th>
                    <th>Description</th>
                    <th>Amount</th>
                    
                </tr>`;


                results.forEach((row, index) => {

                    const dateObj = new Date(row.date);
                    const formattedDate = `${dateObj.getDate()}-${dateObj.getMonth() + 1}-${dateObj.getFullYear()}`;
                
                    htmlContent += `<tr>
                            <td >${index + 1}</td>
                            <td >${formattedDate}</td>
                            <td >${row.from_to}</td>
                            <td >${row.description}</td>
                            <td >${row.amount.toFixed(2)}</td>
                           </tr>`;
                
                  });



                htmlContent += `
            </html>
            `;
          
           
            const options = { 
              format: 'Letter', 
              filename: 'example.pdf', 
            };
          
            
            pdf.create(htmlContent, options).toStream((err, stream) => {
              if (err) {
                res.status(500).send('Internal Server Error');
                return;
              }
          
            
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', 'inline; filename="example.pdf"'); 
          
              
              stream.pipe(res);
            
            
        });
    });


    });



app.get('/Bank-Withdraw', myMiddleware, (req, res) => {
    const username = req.session.username;

    
    const sql = 'SELECT fileName FROM users WHERE id = ?'; 
    db.query(sql, [req.session.user_id], (err, result) => {
        if (err) {
            console.error("Error fetching filename from users table:", err);
            return res.status(500).send("Internal Server Error");
        }

        let fileName = ''; 

  
        if (result.length > 0 && result[0].fileName) {
            fileName = result[0].fileName; 
        }

        res.render('Bank-Withdraw', { username, fileName });
    });
});

app.get('/Bank-Withdraw-view', myMiddleware, (req, res) => {
    const user_id = req.session.user_id;

    if (!user_id) {
        return res.status(401).send('User ID is missing in the session.');
    }

    db.query('SELECT username FROM users WHERE id = ?', [user_id], (err, usernameResults) => {
        if (err) {
            console.error('Error querying database for username:', err);
            return res.status(500).send("Internal Server Error");
        }

        if (usernameResults.length === 0) {
            return res.status(404).send("User not found");
        }

        const username = usernameResults[0].username;

        
        const sql = 'SELECT fileName FROM users WHERE id = ?';
        db.query(sql, [user_id], (filenameErr, filenameResult) => {
            if (filenameErr) {
                console.error("Error fetching filename from users table:", filenameErr);
                return res.status(500).send("Internal Server Error");
            }

            let fileName = ''; 

         
            if (filenameResult.length > 0 && filenameResult[0].fileName) {
                fileName = filenameResult[0].fileName; 
            }

            db.query('SELECT * FROM transactions WHERE transaction_type = "Withdraw" AND type = "Bank" AND credit_debit = "Debit" AND user_id = ?', [user_id], (err, results) => {
                if (err) {
                    console.error('Error querying database:', err);
                    return res.status(500).send("Interal Server Error");
                }

                res.render('Bank-Withdraw-view', { username, fileName, data: results });
            });
        });
    });
});

app.post('/Bank-Withdraw', myMiddleware, (req, res) => {
    const { date, amount, description } = req.body;
    const user_id = req.session.user_id;

    db.query(
        'INSERT INTO transactions (transaction_type, from_to, date, amount, type, credit_debit, description, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['Withdraw', 'Bank', date, amount, 'Bank', 'Debit', description, user_id],
        (insertErr1, insertResults1) => {
            if (insertErr1) {
                console.error("Error inserting bank withdraw transaction:", insertErr1);
                return res.status(500).send("Internal Server Error");
            }
            console.log("Bank withdraw transaction inserted successfully:", insertResults1);

           
            db.query(
                'INSERT INTO transactions (transaction_type, from_to, date, amount, type, credit_debit, description, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                ['Withdraw', 'Me', date, amount, 'Cash', 'Credit', description, user_id],
                (insertErr2, insertResults2) => {
                    if (insertErr2) {
                        console.error("Error inserting cash withdraw transaction:", insertErr2);
                        return res.status(500).send("Internal Server Error");
                    }
                    console.log("Cash withdraw transaction inserted successfully:", insertResults2);
                    res.redirect('/Bank-Withdraw-view');
                }
            );
        }
    );
});

app.get('/edit-Bank-Withdraw/:transactionId', myMiddleware, (req, res) => {
    const transactionId = req.params.transactionId;
    const username = req.session.username;

    const sql = 'SELECT fileName FROM users WHERE id = ?';
    db.query(sql, [req.session.user_id], (filenameErr, filenameResult) => {
        if (filenameErr) {
            console.error("Error fetching filename from users table:", filenameErr);
            return res.status(500).send("Internal Server Error");
        }

        let fileName = ''; 

        if (filenameResult.length > 0 && filenameResult[0].fileName) {
            fileName = filenameResult[0].fileName; 
        }

        const sqlQuery = 'SELECT * FROM transactions WHERE id = ?';
        db.query(sqlQuery, [transactionId], (err, result) => {
            if (err) {
                console.error("Error fetching bank withdraw transaction:", err);
                return res.status(500).send("Internal Server Error");
            }

            if (result.length === 0) {
                console.log("No transaction found for ID:", transactionId);
                return res.status(404).send("Transaction not found");
            }

            res.render('edit-Bank-Withdraw', { Bank_Withdraw_list: result, username, fileName });
        });
    });
});

app.post('/edit-Bank-Withdraw-submit/:transactionId', myMiddleware, (req, res) => {
    const { date, amount, description } = req.body;
    const transactionId = req.params.transactionId;

    const sql = 'UPDATE `transactions` SET date=?, amount=?, description=? WHERE id = ?';

    db.query(sql, [date, amount, description, transactionId], (err) => {
        if (err) {
            console.error("Error updating bank withdraw transaction:", err);
            return res.status(500).send("Internal Server Error");
        }
        console.log("Bank withdraw transaction updated successfully");
        res.redirect('/Bank-Withdraw-view');
    });
});

app.get('/delete-Bank-Withdraw/:transactionId', myMiddleware, (req, res) => {
    const transactionId = req.params.transactionId;
    const sql = 'DELETE FROM transactions WHERE id = ? AND transaction_type = "Withdraw"';

    db.query(sql, [transactionId], (err) => {
        if (err) {
            console.error("Error deleting bank withdrawal transaction:", err);
            return res.status(500).send("Internal Server Error");
        }
        console.log("Bank withdrawal transaction deleted successfully");
        res.redirect('/Bank-Withdraw-view');
    });
});

//Bank-Withdraw-download

app.get('/Bank-Withdraw-pdf', (req, res) => {


    const user_id = req.session.user_id;

    if (!user_id) {
        return res.status(401).send('User ID is missing in the session.');
    }


    db.query('SELECT * FROM transactions WHERE transaction_type = "Withdraw" AND type = "Bank" AND credit_debit = "Debit" AND user_id = ?', [user_id], (err, results) => {
        if (err) {
            console.error('Error querying database:', err);
            return res.status(500).send("Internal Server Error");
        }
        

            var htmlContent = `
            <html>

            <style>
        table, td, th {
        border: 1px solid;
        padding:4px;
        }

        table {
        width: 100%;
        border-collapse: collapse;
        }
        h2{
            text-align:center;
            color:black;
           
        }
        .center{
            text-align:center;
            font-weight:none;
        }
       td{
        text-align:center;
       }
        
        </style>
        <br>
        <h2>Bank-Withdraw-Details</h2>
            <table>
                <tr>
                    <th>S.No</th>
                    <th>Date</th>
                    <th>Amount From</th>
                    <th>Description</th>
                    <th>Amount</th>
                    
                </tr>`;


                results.forEach((row, index) => {

                    const dateObj = new Date(row.date);
                    const formattedDate = `${dateObj.getDate()}-${dateObj.getMonth() + 1}-${dateObj.getFullYear()}`;
                
                    htmlContent += `<tr>
                            <td >${index + 1}</td>
                            <td >${formattedDate}</td>
                            <td >${row.from_to}</td>
                            <td >${row.description}</td>
                            <td >${row.amount.toFixed(2)}</td>

                           </tr>`
                            ;
                
                  });



                htmlContent += `
            </html>
            `;
          
           
            const options = { 
              format: 'Letter', 
              filename: 'example.pdf',
            };
          
           
            pdf.create(htmlContent, options).toStream((err, stream) => {
              if (err) {
                res.status(500).send('Internal Server Error');
                return;
              }
          
              
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', 'inline; filename="example.pdf"'); 
          
              
              stream.pipe(res);
            
            
        });
    });


    });

//Cash-Transaction

app.get('/Cash-Transaction', myMiddleware, (req, res) => {
    const user_id = req.session.user_id;
    const username = req.session.username;

   
    const sql = 'SELECT fileName FROM users WHERE id = ?'; 
    db.query(sql, [user_id], (filenameErr, filenameResult) => {
        if (filenameErr) {
            console.error("Error fetching filename from users table:", filenameErr);
            return res.status(500).send("Internal Server Error");
        }

        let fileName = ''; 

        
        if (filenameResult.length > 0 && filenameResult[0].fileName) {
            fileName = filenameResult[0].fileName; 
        }

        if (!user_id) {
            return res.status(401).send('User ID is missing in the session.');
        }

        const query = 'SELECT * FROM transactions WHERE type = "Cash" AND (credit_debit = "debit" OR credit_debit = "credit") AND user_id = ?';
        db.query(query, [user_id], (error, results) => {
            if (error) {
                console.error('Error querying database:', error);
                res.status(500).send("Internal Server Error");
                return;
            }
            res.render('Cash-Transaction', { username, transactions: results, fileName });
        });
    });
});


//Cash-Transaction-pdf

app.get('/Cash-Transaction-pdf', (req, res) => {
    const user_id = req.session.user_id;
    const username = req.session.username;

    if (!user_id) {
        return res.status(401).send('User ID is missing in the session.');
    }

   
    const query = 'SELECT * FROM transactions WHERE type = "Cash" AND (credit_debit = "debit" OR credit_debit = "credit") AND user_id = ?';
    db.query(query, [user_id], (error, results) => {
        if (error) {
            console.error('Error querying database:', error);
            return res.status(500).send("Internal Server Error");
        }
        
        if (results.length === 0) {
            return res.status(404).send('No transactions found.');
        }

        let htmlContent = `
        <html>
            <style>
                table, td, th {
                    border: 1px solid;
                    padding: 4px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                }
                h2 {
                    text-align: center;
                    color: black;
                   
                }
                td{
                    text-align:center;
                }
            </style>
            <br>
            <h2>Cash-Transaction-Details</h2>
            <table class="table table-bordered">
                <tr>
                    <th>S.NO</th>
                    <th>Date</th>
                    <th>Description</th>
                    <th class="text-right">Credit</th>
                    <th class="text-right">Debit</th>
                    <th class="text-right">Balance</th>
                </tr>`;

        let totalCredit = 0;
        let totalDebit = 0;
        let balance = 0;

        results.forEach((row, index) => {
            const dateObj = new Date(row.date);
            const formattedDate = `${dateObj.getDate()}-${dateObj.getMonth() + 1}-${dateObj.getFullYear()}`;
            const amount = row.amount;

            if (row.credit_debit === "Credit") {
                totalCredit += amount;
                balance += amount;
            } else {
                totalDebit += amount;
                balance -= amount;
            }

            htmlContent += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${formattedDate}</td>
                    <td>${row.description}</td>
                    <td class="text-right">${row.credit_debit === 'Credit' ? `₹ ${amount.toFixed(2)}` : ''}</td>
                    <td class="text-right">${row.credit_debit === 'Debit' ? `₹ ${amount.toFixed(2)}` : ''}</td>
                    <td class="text-right">₹ ${balance.toFixed(2)}</td>
                </tr>`;
        });

        const totalBalance = totalCredit - totalDebit;

        htmlContent += `
            <tr>
                <td colspan="3" class="text-right"><strong>Total</strong></td>
                <td class="text-right"><strong>₹ ${totalCredit.toFixed(2)}</strong></td>
                <td class="text-right"><strong>₹ ${totalDebit.toFixed(2)}</strong></td>
                <td class="text-right"><strong>₹ ${totalBalance.toFixed(2)}</strong></td>
            </tr>
        </table></html>`;

        
        const options = { 
            format: 'Letter',
            filename: 'Cash_Transaction_Report.pdf', 
        };

        pdf.create(htmlContent, options).toStream((err, stream) => {
            if (err) {
                console.error('Error generating PDF:', err);
                return res.status(500).send('Internal Server Error');
            }

          
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'inline; filename="Cash_Transaction_Report.pdf"');

         
            stream.pipe(res);
        });
    });
});


//Bank-Transaction

app.get('/Bank-Transaction', myMiddleware, (req, res) => {
    const user_id = req.session.user_id;
    const username = req.session.username;

   
    const sql = 'SELECT fileName FROM users WHERE id = ?'; 
    db.query(sql, [user_id], (filenameErr, filenameResult) => {
        if (filenameErr) {
            console.error("Error fetching filename from users table:", filenameErr);
            return res.status(500).send("Internal Server Error");
        }

        let fileName = ''; 

     
        if (filenameResult.length > 0 && filenameResult[0].fileName) {
            fileName = filenameResult[0].fileName; 
        }

        if (!user_id) {
            return res.status(401).send('User ID is missing in the session.');
        }

        const query = 'SELECT * FROM transactions WHERE type = "Bank" AND (credit_debit = "debit" OR credit_debit = "credit") AND user_id = ?';
        db.query(query, [user_id], (error, results) => {
            if (error) {
                console.error('Error querying database:', error);
                res.status(500).send("Internal Server Error");
                return;
            }
            
            res.render('Bank-Transaction', { username, transactions: results, fileName });
        });
    });
});


//Bank-Transaction-pdf
app.get('/Bank-Transaction-pdf', (req, res) => {
    const user_id = req.session.user_id;
    const username = req.session.username; 

    if (!user_id) {
        return res.status(401).send('User ID is missing in the session.');
    }

    
    const query = 'SELECT * FROM transactions WHERE type = "Bank" AND (credit_debit = "debit" OR credit_debit = "credit") AND user_id = ?';
    db.query(query, [user_id], (error, results) => {
        if (error) {
            console.error('Error querying database:', error);
            res.status(500).send("Internal Server Error");
            return;
        }
        
        if (results.length === 0) {
            return res.status(404).send('No transactions found.');
        }

        let htmlContent = `
        <html>
            <style>
                table, td, th {
                    border: 1px solid;
                    padding: 4px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                }
                h2 {
                    text-align: center;
                    color: black;
                   
                }
                td{
                    text-align:center;
                }
            </style>
            <br>
            <h2>Bank-Transaction-Details</h2>
            <table class="table table-bordered">
                <tr>
                    <th>S.NO</th>
                    <th>Date</th>
                    <th>Description</th>
                    <th class="text-right">Credit</th>
                    <th class="text-right">Debit</th>
                    <th class="text-right">Balance</th>
                </tr>`;

        let totalCredit = 0;
        let totalDebit = 0;
        let balance = 0;

        results.forEach((row, index) => {
            const dateObj = new Date(row.date);
            const formattedDate = `${dateObj.getDate()}-${dateObj.getMonth() + 1}-${dateObj.getFullYear()}`;
            const amount = row.amount;

            if (row.credit_debit === "Credit") {
                totalCredit += amount;
                balance += amount;
            } else {
                totalDebit += amount;
                balance -= amount;
            }

            htmlContent += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${formattedDate}</td>
                    <td>${row.description}</td>
                    <td class="text-right">${row.credit_debit === 'Credit' ? `₹ ${amount.toFixed(2)}` : ''}</td>
                    <td class="text-right">${row.credit_debit === 'Debit' ? `₹ ${amount.toFixed(2)}` : ''}</td>
                    <td class="text-right">₹ ${balance.toFixed(2)}</td>
                </tr>`;
        });

        const totalBalance = totalCredit - totalDebit;

        htmlContent += `
            <tr>
                <td colspan="3" class="text-right"><strong>Total</strong></td>
                <td class="text-right"><strong>₹ ${totalCredit.toFixed(2)}</strong></td>
                <td class="text-right"><strong>₹ ${totalDebit.toFixed(2)}</strong></td>
                <td class="text-right"><strong>₹ ${totalBalance.toFixed(2)}</strong></td>
            </tr>
        </table></html>`;

        const options = { 
            format: 'Letter', 
            filename: 'Cash_Transaction_Report.pdf',
        };

       
        pdf.create(htmlContent, options).toStream((err, stream) => {
            if (err) {
                console.error('Error generating PDF:', err);
                return res.status(500).send('Internal Server Error');
            }

           
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'inline; filename="Cash_Transaction_Report.pdf"'); 

            
            stream.pipe(res);
        });
    });
});



const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'vjdinesh8904@gmail.com', 
        pass: 'axagivqvmsaiazsb' 
    }
});


app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { messages: req.flash('error') });
});


app.post('/forgot_password', (req, res) => {
    const { email } = req.body;

    console.log(email);
    ``

    db.query('SELECT * FROM users WHERE email = ?', [email], (error, results) => {

        if (error) {
            console.error('Error querying database:', error);
            res.status(500).send({ error: 'Internal server error' });
            return;
        }

        console.log(results);
        if (results.length > 0) {

            const min = 1000; 
            const max = 9999; 
            const randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;

            req.session.randomNumber = randomNumber;
            req.session.email = email;

            
            const mailOptions = {
                from: 'vjdinesh8904@gmail.com', 
                to: email, 
                subject: 'OTP Email', 
                text: 'Your OTP is '+randomNumber 
              };
            
              // Send email

              transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                  console.log('Error occurred:', error);
                  res.send('Error sending email');
                } else {
                  console.log('Email sent:', info.response);
                  res.redirect('/otp'); 
                 // res.send('Email sent successfully');
                }
              });


        } else {
            // Email doesn't exist
            req.flash('error', 'Email address not found.');
            res.redirect('/forgot-password'); 
        }
    
    app.post('/resend-otp', (req, res) => {
    const email = req.session.email; 
    const randomNumber = req.session.randomNumber; 

    const mailOptions = {
        from: 'vjdinesh8904@gmail.com', 
        to: email, 
        subject: 'OTP Email', 
        text: 'Your OTP is ' + randomNumber 
    };

    // Send email
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.log('Error occurred:', error);
            res.send('Error sending email');
        } else {
            console.log('Email sent:', info.response);
            res.redirect('/otp'); 
        }
    });
});
    });
});

app.get('/new-password', (req, res) => {
    res.render('new-password');
});

app.post('/check-newpassword', (req, res) => {
    const { newPassword, confirmPassword } = req.body;

    // Check if newPassword meets requirements
    const passwordRegex = /^(?=.[0-9])(?=.[!@#$%^&])[a-zA-Z0-9!@#$%^&]{6,}$/;
    if (!passwordRegex.test(newPassword)) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long and contain at least one symbol and one number' });
    }

    // Check if newPassword and confirmPassword match
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'Passwords do not match' });
    }

   
    return res.status(200).json({ message: 'Password validation successful' });
});

// Check if OTP is verified

app.get('/check-otp', (req, res) => {
    

    if (req.session.otpVerified) {
        return res.status(200).json({ message: 'OTP verified' });
    } else {
        return res.status(400).json({ error: 'OTP not verified' });
    }
});



app.post('/new-password', (req, res) => {
    const {  password } = req.body;

    var email = req.session.email;

    

        // Update the password in the database
        db.query(
            'UPDATE users SET password = ? WHERE email = ?', [password, email],
            (updateErr, updateResults) => {
                if (updateErr) {
                    console.error("Error updating password:", updateErr);
                    res.status(500).send("Internal Server Error");
                    return;
                }
              
                req.flash('error', 'Password updated successfully.');
            res.redirect('/login'); 
            }
        );
    
    });

    app.get('/otp', (req, res) => {
        res.render('otp');
    });
    
    // Verify OTP
    app.post('/otp', (req, res) => {
        const enteredOTP = req.body.otp;
        const storedOTP = req.session.randomNumber; 
    
        if (!enteredOTP || !storedOTP) {
            req.flash('error', 'Please provide OTP');
            return res.redirect('/otp');
        }
    
        if (enteredOTP == storedOTP) { 
            // OTP is correct
            req.session.otpVerified = true;
            req.flash('success', 'OTP verified successfully');
            return res.redirect('/new-password');
        } else {
            // OTP is incorrect
            req.flash('error', 'Incorrect OTP. Please try again.');
            return res.redirect('/otp');
        }
    });
    





app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.redirect('/');
        }
        res.redirect('login');
    });
});

app.get('/Download', async (req, res) => {
    const user_id = req.session.user_id;

    if (!user_id) {
        return res.status(401).send('User ID is missing in the session.');
    }

   
    db.query('SELECT * FROM transactions WHERE transaction_type = "Income" AND user_id = ?', [user_id], (err, incomeResults) => {
        if (err) {
            console.error('Error querying income transactions from the database:', err);
            return res.status(500).send('Internal Server Error');
        }

      
        let incomeHtmlContent = `
            <html>
            <head>
           
            <style>
                table, td, th {
                    border: 1px solid;
                    padding: 4px;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                }

                h2 {
                    text-align: center;
                    color: black;
                }

                td {
                    text-align: center;
                }
            </style>
            </head>
            <br>
            <h2>Income-Details</h2>
            <table class="table table-bordered">
                <tr>
                    <th>S.No</th>
                    <th>Date</th>
                    <th>Amount From</th>
                    <th>Description</th>
                    <th class="text-right">Amount</th>
                </tr>`;

        incomeResults.forEach((row, index) => {
            const dateObj = new Date(row.date);
            const formattedDate = `${dateObj.getDate()}-${dateObj.getMonth() + 1}-${dateObj.getFullYear()}`;
            incomeHtmlContent += `<tr>
                                    <td>${index + 1}</td>
                                    <td>${formattedDate}</td>
                                    <td>${row.from_to}</td>
                                    <td>${row.description}</td>
                                    <td>${row.amount.toFixed(2)}</td>
                                </tr>`;
        });

        incomeHtmlContent += `</table></html>`;

        
        db.query('SELECT * FROM transactions WHERE transaction_type = "Spend" AND user_id = ?', [user_id], (err, spendResults) => {
            if (err) {
                console.error('Error querying spend transactions from the database:', err);
                return res.status(500).send('Internal Server Error');
            }

           
            let spendHtmlContent = `
                <html>
                <style>
                    table, td, th {
                        border: 1px solid;
                        padding: 4px;
                    }

                    table {
                        width: 100%;
                        border-collapse: collapse;
                    }

                    h2 {
                        text-align: center;
                        color: black;
                    }

                    td {
                        text-align: center;
                    }
                </style>
                <br>
                <h2>Spend-Details</h2>
                <table class="table table-bordered">
                    <tr>
                        <th>S.No</th>
                        <th>Date</th>
                        <th>Amount From</th>
                        <th>Description</th>
                        <th class="text-right">Amount</th>
                    </tr>`;

            spendResults.forEach((row, index) => {
                const dateObj = new Date(row.date);
                const formattedDate = `${dateObj.getDate()}-${dateObj.getMonth() + 1}-${dateObj.getFullYear()}`;
                spendHtmlContent += `<tr>
                                        <td>${index + 1}</td>
                                        <td>${formattedDate}</td>
                                        <td>${row.from_to}</td>
                                        <td>${row.description}</td>
                                        <td>${row.amount.toFixed(2)}</td>
                                    </tr>`;
            });

            spendHtmlContent += `</table></html>`;

           
            db.query('SELECT * FROM transactions WHERE transaction_type = "Deposite" AND type = "Bank" AND credit_debit = "Credit" AND user_id = ?', [user_id], (err, depositResults) => {
                if (err) {
                    console.error('Error querying bank deposit transactions from the database:', err);
                    return res.status(500).send('Internal Server Error');
                }

               
                let depositHtmlContent = `
                    <html>
                    <style>
                        table, td, th {
                            border: 1px solid;
                            padding: 4px;
                        }

                        table {
                            width: 100%;
                            border-collapse: collapse;
                        }

                        h2 {
                            text-align: center;
                            color: black;
                        }

                        td {
                            text-align: center;
                        }
                    </style>
                    <br>
                    <h2>Bank Deposit Details</h2>
                    <table class="table table-bordered">
                        <tr>
                            <th>S.No</th>
                            <th>Date</th>
                            <th>Amount From</th>
                            <th>Description</th>
                            <th class="text-right">Amount</th>
                        </tr>`;

                depositResults.forEach((row, index) => {
                    const dateObj = new Date(row.date);
                    const formattedDate = `${dateObj.getDate()}-${dateObj.getMonth() + 1}-${dateObj.getFullYear()}`;
                    depositHtmlContent += `<tr>
                                            <td>${index + 1}</td>
                                            <td>${formattedDate}</td>
                                            <td>${row.from_to}</td>
                                            <td>${row.description}</td>
                                            <td>${row.amount.toFixed(2)}</td>
                                        </tr>`;
                });

                depositHtmlContent += `</table></html>`;

               
                db.query('SELECT * FROM transactions WHERE transaction_type = "Withdraw" AND type = "Bank" AND credit_debit = "Debit" AND user_id = ?', [user_id], (err, withdrawResults) => {
                    if (err) {
                        console.error('Error querying bank withdraw transactions from the database:', err);
                        return res.status(500).send('Internal Server Error');
                    }

                    let withdrawHtmlContent = `
                        <html>
                        <style>
                            table, td, th {
                                border: 1px solid;
                                padding: 4px;
                            }

                            table {
                                width: 100%;
                                border-collapse: collapse;
                            }

                            h2 {
                                text-align: center;
                                color: black;
                            }

                            td {
                                text-align: center;
                            }
                        </style>
                        <br>
                        <h2>Bank Withdraw Details</h2>
                        <table class="table table-bordered">
                            <tr>
                                <th>S.No</th>
                                <th>Date</th>
                                <th>Amount From</th>
                                <th>Description</th>
                                <th class="text-right">Amount</th>
                            </tr>`;

                    withdrawResults.forEach((row, index) => {
                        const dateObj = new Date(row.date);
                        const formattedDate = `${dateObj.getDate()}-${dateObj.getMonth() + 1}-${dateObj.getFullYear()}`;
                        withdrawHtmlContent += `<tr>
                                                <td>${index + 1}</td>
                                                <td>${formattedDate}</td>
                                                <td>${row.from_to}</td>
                                                <td>${row.description}</td>
                                                <td>${row.amount.toFixed(2)}</td>
                                            </tr>`;
                    });

                    withdrawHtmlContent += `</table></html>`;

                    
    
    const query = 'SELECT * FROM transactions WHERE type = "Cash" AND (credit_debit = "debit" OR credit_debit = "credit") AND user_id = ?';
    db.query(query, [user_id], (error, results) => {
        if (error) {
            console.error('Error querying database:', error);
            return res.status(500).send("Internal Server Error");
        }
        
        if (results.length === 0) {
            return res.status(404).send('No transactions found.');
        }

        let CashTransactionhtmlContent = `
        <html>
            <style>
                table, td, th {
                    border: 1px solid;
                    padding: 4px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                }
                h2 {
                    text-align: center;
                    color: black;
                   
                }
                td{
                    text-align:center;
                }
            </style>
            <br>
            <h2>Cash-Transaction-Details</h2>
            <table class="table table-bordered">
                <tr>
                    <th>S.NO</th>
                    <th>Date</th>
                    <th>Description</th>
                    <th class="text-right">Credit</th>
                    <th class="text-right">Debit</th>
                    <th class="text-right">Balance</th>
                </tr>`;

        let totalCredit = 0;
        let totalDebit = 0;
        let balance = 0;

        results.forEach((row, index) => {
            const dateObj = new Date(row.date);
            const formattedDate = `${dateObj.getDate()}-${dateObj.getMonth() + 1}-${dateObj.getFullYear()}`;
            const amount = row.amount;

            if (row.credit_debit === "Credit") {
                totalCredit += amount;
                balance += amount;
            } else {
                totalDebit += amount;
                balance -= amount;
            }

            CashTransactionhtmlContent += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${formattedDate}</td>
                    <td>${row.description}</td>
                    <td class="text-right">${row.credit_debit === 'Credit' ? `₹ ${amount.toFixed(2)}` : ''}</td>
                    <td class="text-right">${row.credit_debit === 'Debit' ? `₹ ${amount.toFixed(2)}` : ''}</td>
                    <td class="text-right">₹ ${balance.toFixed(2)}</td>
                </tr>`;
        });

        const totalBalance = totalCredit - totalDebit;

        CashTransactionhtmlContent += `
            <tr>
                <td colspan="3" class="text-right"><strong>Total</strong></td>
                <td class="text-right"><strong>₹ ${totalCredit.toFixed(2)}</strong></td>
                <td class="text-right"><strong>₹ ${totalDebit.toFixed(2)}</strong></td>
                <td class="text-right"><strong>₹ ${totalBalance.toFixed(2)}</strong></td>
            </tr>
        </table></html>`;

        
    
    const query = 'SELECT * FROM transactions WHERE type = "Bank" AND (credit_debit = "debit" OR credit_debit = "credit") AND user_id = ?';
    db.query(query, [user_id], (error, results) => {
        if (error) {
            console.error('Error querying database:', error);
            res.status(500).send("Internal Server Error");
            return;
        }
        
        if (results.length === 0) {
            req.flash('error', 'No transactions found.');
            res.render('/download', { flashMessages: req.flash('error') });
           
          }

        let BankTransactionhtmlContent = `
        <html>
            <style>
                table, td, th {
                    border: 1px solid;
                    padding: 4px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                }
                h2 {
                    text-align: center;
                    color: black;
                   
                }
                td{
                    text-align:center;
                }
            </style>
            <br>
            <h2>Bank-Transaction-Details</h2>
            <table class="table table-bordered">
                <tr>
                    <th>S.NO</th>
                    <th>Date</th>
                    <th>Description</th>
                    <th class="text-right">Credit</th>
                    <th class="text-right">Debit</th>
                    <th class="text-right">Balance</th>
                </tr>`;

        let totalCredit = 0;
        let totalDebit = 0;
        let balance = 0;

        results.forEach((row, index) => {
            const dateObj = new Date(row.date);
            const formattedDate = `${dateObj.getDate()}-${dateObj.getMonth() + 1}-${dateObj.getFullYear()}`;
            const amount = row.amount;

            if (row.credit_debit === "Credit") {
                totalCredit += amount;
                balance += amount;
            } else {
                totalDebit += amount;
                balance -= amount;
            }

            BankTransactionhtmlContent += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${formattedDate}</td>
                    <td>${row.description}</td>
                    <td class="text-right">${row.credit_debit === 'Credit' ? `₹ ${amount.toFixed(2)}` : ''}</td>
                    <td class="text-right">${row.credit_debit === 'Debit' ? `₹ ${amount.toFixed(2)}` : ''}</td>
                    <td class="text-right">₹ ${balance.toFixed(2)}</td>
                </tr>`;
        });

        const totalBalance = totalCredit - totalDebit;

        BankTransactionhtmlContent += `
            <tr>
                <td colspan="3" class="text-right"><strong>Total</strong></td>
                <td class="text-right"><strong>₹ ${totalCredit.toFixed(2)}</strong></td>
                <td class="text-right"><strong>₹ ${totalDebit.toFixed(2)}</strong></td>
                <td class="text-right"><strong>₹ ${totalBalance.toFixed(2)}</strong></td>
            </tr>
        </table></html>`;

                    
                    const combinedHtmlContent = incomeHtmlContent + spendHtmlContent + depositHtmlContent + withdrawHtmlContent + CashTransactionhtmlContent + BankTransactionhtmlContent;

                    
                    const options = { 
                        format: 'Letter',
                        filename: 'example.pdf',
                    };

                   
                    pdf.create(combinedHtmlContent, options).toStream((err, stream) => {
                        if (err) {
                            res.status(500).send('Internal Server Error');
                            return;
                        }

                        
                        res.setHeader('Content-Type', 'application/pdf');
                        res.setHeader('Content-Disposition', 'inline; filename="Transaction.pdf"');

                        
                        stream.pipe(res);
                    });
                });
            });
        });
    });
});


});
});




app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});




