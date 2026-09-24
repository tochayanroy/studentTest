const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const passport = require('passport');

const app = express();


require('./config/cloudinary');
require('./config/Database');
require('./middleware/passport-jwt');

const userRoutes = require('./routes/userRoutes');
const examRoutes = require('./routes/examRoutes');
const attemptRoutes = require('./routes/attemptRoutes');
const DocumentRoutes = require('./routes/DocumentRoutes');

app.use(express.json());
app.use(passport.initialize());

app.use('/users', userRoutes);
app.use('/exams', examRoutes);
app.use('/attempts', attemptRoutes);
app.use('/documents', DocumentRoutes);

app.get('/', (req, res) => {
    res.json({ message: 'Student Examination API is running' });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.listen(process.env.PORT, () => {
    console.log(`Server is running on port ${process.env.PORT}`);
});