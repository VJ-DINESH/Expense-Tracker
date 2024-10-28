const express = require('express');
const mysql = require('mysql');
const ejs = require('ejs');
const bodyParser = require('body-parser');


const app = express();
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: false }));


// MySQL Connection Configuration
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'students' // Name of the database you created
});

// Connect to MySQL
db.connect((err) => {
    if (err) {
        throw err;
    }
    console.log('MySQL Connected...');
});

app.get('/', (req, res) => {
    const sql = 'SELECT * FROM students';
    db.query(sql, (err, result) => {
        if (err) {
            throw err;
        }
       
        res.render('student_list', { student_list: result});

    });
});

app.get('/student-add', (req, res) => {
    res.render('student_add');
});

app.post('/add-student-submit', (req, res) => {
    const { name, dob, phone, email, gender, address } = req.body;
    
    const query = 'INSERT INTO students (name, dob, phone, email, gender, address) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(query, [name, dob, phone, email, gender, address], (err, results) => {
        if (err) {
            console.error('Error inserting data into MySQL:', err);
            res.status(500).send('Error inserting data into MySQL');
        } else {
            console.log('Data inserted into MySQL');
            res.redirect('/');
        }
    });
});

app.get('/student-edit/:studentId', (req, res) => {
    const studentId = req.params.studentId;
    const sql = 'SELECT * FROM students WHERE id = ?';
    
    db.query(sql, studentId, (err, result) => {
        if (err) {
            throw err;
        }
    
        res.render('student_edit', { student: result[0] });
    });
});

app.post('/edit-student-submit/:studentId', (req, res) => {
    const studentId = req.params.studentId;
    const name = req.body.name;
    const regno = req.body.regno;
    const dob = req.body.dob;
    const phone = req.body.phone;
    const email = req.body.email;
    const gender = req.body.gender;
    const address = req.body.address;

    const sql = 'UPDATE students SET name=?, regno=?, dob=?, phone=?, email=?, gender=?, address=? WHERE id=?';
    const values = [name, regno, dob, phone, email, gender, address, studentId];
    
    db.query(sql, values, (err) => {
        if (err) {
            throw err;
        }
        res.redirect('/');
    });
});


app.get('/delete-student/:studentId', (req, res) => {
    const studentId = req.params.studentId;
    const sql = 'DELETE FROM students WHERE id = ?';

    db.query(sql, studentId, (err, result) => {
        if (err) {
            throw err;
        }
        console.log(`Student with ID ${studentId} has been deleted successfully`);
        res.redirect('/'); // Redirect to the student list page after deletion
    });
});




const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
