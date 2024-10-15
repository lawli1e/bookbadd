//index.js
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const app = express();
const cron = require('node-cron');


app.set('view engine', 'ejs');
app.use(express.json());
const secret = 'mysecret';
let pool = null;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


cron.schedule('* * * * *', async () => {
  console.log('Running scheduled job...');
  // Your scheduled task logic goes here
});


const initMySQL = async () => {
  try {
    pool = await mysql.createPool ({
      host: 'localhost',
      user: 'root',
      password: 'root',
      port: '3306',
      database: 'tutorial'
    });
    return pool;
  } catch (error) {
    console.error('Error initializing MySQL:', error);
    throw error; // Throw the error so it can be caught and handled properly
  }
};

const ensureMySQLInitialized = async (req, res, next) => {
  try {
    if (!pool) {
      await initMySQL();
    }
    next();
  } catch (error) {
    console.error('Error initializing MySQL:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
app.use(ensureMySQLInitialized);

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Render the login form
app.get("/login", (req, res) => {
  res.render('login');
});

// Render the register form
app.get("/register", (req, res) => {
  res.render('register');
});

app.get("/bookingStatus-pending", (req, res) => {
  res.render('bookingStatus-pending');
});

app.get("/bookingStatus", (req, res) => {
  res.render('bookingStatus');
});

app.get("/payment", (req, res) => {
  res.render('payment');
});

app.get("/logout", (req, res) => {
  res.redirect("/login");
});


app.get('/reservation', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  res.render('reservation', { today: today });
});

app.get('/reservation-test', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  res.render('reservation-test', { today: today });
});

//register
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", email);
  if (rows.length) {
    return res.status(400).send({ message: "Email is already registered" });
  }

  const hash = await bcrypt.hash(password, 10);
  const userData = { email, password: hash ,role: 'admin'};
  try {
    const result = await pool.query("INSERT INTO users SET ?", userData);
  } catch (error) {
    console.error(error);
    res.status(400).json({
      message: "insert fail",
      error,
    });
  }
  res.status(201).send({ message: "User registered successfully" });
});

//login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const [result] = await pool.query("SELECT * from users WHERE email = ?", email);
  const user = result[0];
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.status(400).send({ message: "Invalid email or password" });
  }

  //create token
  const token = jwt.sign({ email: user.email, role: user.role }, secret, { expiresIn: "1h" });
  res.cookie

  res.send({ message: "Login successful", token });
});


cron.schedule('* * * * *', async () => {
  console.log('Running scheduled job to delete expired bookings...');

  const expiryTime = new Date();
  expiryTime.setMinutes(expiryTime.getMinutes() - 5); // Assuming bookings expire after 5 minutes

  try {
      const connection = await pool.getConnection();
      const [results] = await connection.query(
          'DELETE FROM reservations WHERE status = "pending" AND created_at < ?',
          [expiryTime]
      );
      connection.release();
      console.log(`Deleted ${results.affectedRows} expired bookings.`);
  } catch (error) {
      console.error('Error deleting expired bookings:', error);
  }
});



const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token == null) return res.sendStatus(401); // if there isn't any token

  try {
    const user = jwt.verify(token, secret);
    req.user = user;
    console.log("user", user);
    next();
  } catch (error) {
    return res.sendStatus(403);
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).send('Forbidden'); // User is not an admin
  }
  next();
};

// Adjust the server-side code to handle cancellation using a POST request
app.post('/api/cancel-booking/:bookingId', authenticateToken, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userEmail = req.user.email;
    console.log("Booking ID:", bookingId); // Log the bookingId parameter
    console.log("User email:", userEmail);

    try {
      console.log("Executing DELETE query...");
      console.log("Booking ID before deletion:", bookingId); // Log bookingId before deletion
      const [result] = await pool.query('DELETE FROM reservations WHERE id = ?', [bookingId]);
      if (result.affectedRows > 0) {
        console.log('Booking cancelled successfully:', bookingId);
        res.status(200).send('Booking cancelled successfully');
      } else {
        console.log('Failed to cancel booking:', bookingId);
        res.status(500).send('Failed to cancel booking');
      }
    } catch (error) {
      console.error('Error deleting booking:', error);
      res.status(500).send('Failed to cancel booking');
    }
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).send('Internal server error');
  }
});

app.post("/api/photoDB", authenticateToken, upload.single('paymentSlip'), async (req, res) => {
  try {
    const image = req.file.buffer.toString('base64');
    let reservationIds = req.body.reservationId;
    if (!Array.isArray(reservationIds)) {
      reservationIds = [reservationIds];
    }
    console.log('reservationID :', reservationIds);

    if (!Array.isArray(reservationIds) || reservationIds.length === 0) {
      throw new Error("Reservation IDs must be provided as an array");
    }

    const userEmail = req.user ? req.user.email : null; 
    if (!userEmail) {
      throw new Error("User email not found");
    }
    const [userRows] = await pool.query('SELECT id FROM users WHERE email = ?', [userEmail]);
    const userId = userRows[0].id;

    const [maxOrderIdRows] = await pool.query('SELECT MAX(order_id) AS maxOrderId FROM payments');
    const maxOrderId = maxOrderIdRows[0].maxOrderId || 0;

    for (const reservationId of reservationIds) {
      const nextOrderId = maxOrderId + 1;
      const query = `
        INSERT INTO payments (user_id, reservation_id, payment_slip, status, order_id)
        VALUES (?, ?, ?, 'waiting', ?)
      `;

      
      const values = [userId, reservationId, image,nextOrderId];
  
      await pool.query(query, values);
    }

    console.log("Payment data inserted successfully");
    res.status(200).send("Payment data inserted successfully");
  } catch (error) {
    console.error("Error inserting payment data into database:", error);
    res.status(500).send("Error inserting payment data into database");
  }
});


app.get('/api/bookings', async (req, res) => {
  const {date,court} = req.query;
  try {
    const [rows] = await pool.query('SELECT time FROM reservations WHERE date = ? AND court = ?', [date, court]);
    res.json(rows.map(row => row.time));
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/booking-status', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const [bookings] = await pool.query(`
      SELECT id, date, time, status, court
      FROM reservations
      WHERE userId = (SELECT id FROM users WHERE email = ? AND status = 'pending')
    `, [userEmail]);
    res.json(bookings); // Sending bookings data as JSON response
  } catch (error) {
    console.error('Error fetching booking status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.get('/api/booking-status2', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const [bookings] = await pool.query("SELECT id, date, time,court, status FROM reservations WHERE userId = (SELECT id FROM users WHERE email = ?)" , [userEmail]);
    res.json(bookings); // Sending bookings data as JSON response
  } catch (error) {
    console.error('Error fetching booking status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/reservation', authenticateToken, async (req, res) => {
  try {
    const { date, time, court } = req.body;
    const userEmail = req.user.email;
    console.log('data :', {date,time,court})
    const [userRows] = await pool.query('SELECT id FROM users WHERE email = ?', [userEmail]);
    if (userRows.length === 0) {
      return res.status(404).send('User not found');
    }
    const userId = userRows[0].id;
    const parsedTime = time + ':00';

    const [existingReservations] = await pool.query('SELECT * FROM reservations WHERE date = ? AND time = ? AND court = ?', [date, parsedTime, court]);
    if (existingReservations.length > 0) {
      return res.status(400).send('Selected date, time, and court are already booked');
    }

    const [result] = await pool.query('INSERT INTO reservations (date, time, userId, court, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)', [date, parsedTime, userId, court]);
    if (result.affectedRows > 0) {
      console.log('Reservation data inserted into database:', { date, time: parsedTime, userId, court });
      
      res.status(200).send('Reservation successful');
    } else {
      res.status(500).send('Failed to insert reservation data into database');
    }
  } catch (error) {
    console.error('Error inserting reservation data into database:', error);
    res.status(500).send('Internal server error');
  }
});

app.get('/api/courts', async (req, res) => {
  try {
      // Fetch distinct court IDs from reservations
      const [courtRows] = await pool.query('SELECT DISTINCT court FROM reservations');
      const courtIds = courtRows.map(row => row.court);

      // Fetch court information for the retrieved court IDs
      const [courtInfoRows] = await pool.query('SELECT * FROM courts WHERE id IN (?)', [courtIds]);
      
      res.status(200).json(courtInfoRows); // Return court information as JSON
  } catch (error) {
      console.error('Error fetching court information:', error);
      res.status(500).send('Internal server error');
  }
});

app.get("/api/users", authenticateToken, async (req, res) => {
  try {
    // Get the users
    const [results] = await pool.query("SELECT email FROM users");
    const users = results.map((row) => row.email);

    res.send(users);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
});

app.get('/admin-payment', async (req, res) => {
    res.render('admin');
});


// Add the following route to fetch all payments data
app.get('/api/payments', async (req, res) => {
  try {
    // Query to fetch all payments data
    const [rows] = await pool.query('SELECT * FROM payments');
    // Send JSON response with payments data
    res.json(rows);
  } catch (error) {
    console.error('Error fetching payments data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// POST endpoint to approve a payment
app.post('/api/payments/approve',authenticateToken,isAdmin, async (req, res) => {
  try {
      const { paymentId } = req.body;
      console.log('payment ID:',paymentId)
      await pool.query('UPDATE payments SET status = ? WHERE id = ?', ['approved', paymentId]);
      res.status(200).json({ message: 'Payment approved successfully' });
  } catch (error) {
      console.error('Error approving payment:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// POST endpoint to decline a payment
app.post('/api/payments/decline',authenticateToken,isAdmin, async (req, res) => {
  try {
      const { paymentId } = req.body;
      await pool.query('UPDATE payments SET status = ? WHERE id = ?', ['declined', paymentId]);
      res.status(200).json({ message: 'Payment declined successfully' });
  } catch (error) {
      console.error('Error declining payment:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


const port = process.env.PORT || 3000;
app.listen(port, async () => {
  await initMySQL();
  console.log(`Server is running on port ${port}`);
});

process.on('exit', () => {
  if (pool) {
    pool.end();
    console.log('MySQL connection closed');
  }
});
