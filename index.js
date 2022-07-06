const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const nodemailer = require('nodemailer');
const sgTransport = require('nodemailer-sendgrid-transport');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

// function to verify JWT Token
function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized Access' });
    }
    const token = authHeader.split(' ')[1];
    // verify a token
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' });
        }
        // console.log('decoded', decoded);
        req.decoded = decoded;
        next();
    });
}

//TEMPLATE STRING
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nbzps.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });
// console.log(uri);

// For Email Send to the Client(Configuration)

const emailSenderOptions = {
    auth: {
        api_key: process.env.EMAIL_SENDER_KEY
    }
}

const emailClient = nodemailer.createTransport(sgTransport(emailSenderOptions));

// function to email to the client who got an appointment
function sendAppointmentEmail(booking) {
    const { patient, patientName, treatment, date, slot } = booking;

    var email = {
        from: process.env.EMAIL_SENDER,
        to: patient,
        subject: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
        text: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
        html: `
            <div>
            <p>Hello ${patientName}</p>
            <h3>Your Appointment for ${treatment} is confirmed</h3>
            <p>Looking forward to seeing you on ${date} at ${slot}.</p>
            
            <h3>Our Address</h3>
            <p>Bangladesh</p>
            <a href="https://doctors-portal-380b9.web.app/">unsubscribe</a>
            </div>
        `
    };

    emailClient.sendMail(email, function (err, info) {
        if (err) {
            console.log(err);
        }
        else {
            console.log('Message sent: ', info);
        }
    });

}
// function to email to the client who have completed payment for an appointment
function sendPaymentConfirmationEmail(booking) {
    const { patient, patientName, treatment, date, slot } = booking;

    var email = {
        from: process.env.EMAIL_SENDER,
        to: patient,
        subject: `We have received your payment for ${treatment} is on ${date} at ${slot} is Confirmed`,
        text: `Your payment for this Appointment ${treatment} is on ${date} at ${slot} is Confirmed`,
        html: `
            <div>
            <p>Hello ${patientName}</p>
            <h3>Thank you for your payment.</h3>
            <h3>We have received your payment.</h3>
            
            <p>Looking forward to seeing you on ${date} at ${slot}.</p>
            
            <h3>Our Address</h3>
            <p>Bangladesh</p>
            <a href="https://doctors-portal-380b9.web.app/">unsubscribe</a>
            </div>
        `
    };

    emailClient.sendMail(email, function (err, info) {
        if (err) {
            console.log(err);
        }
        else {
            console.log('Message sent: ', info);
        }
    });

}

async function run() {
    try {
        await client.connect();
        // console.log('Database connected');
        const serviceCollection = client.db('doctors_portal').collection('services');
        const bookingCollection = client.db('doctors_portal').collection('booking');
        const userCollection = client.db('doctors_portal').collection('users');
        const doctorCollection = client.db('doctors_portal').collection('doctors');
        const paymentCollection = client.db('doctors_portal').collection('payments');

        // To verify whether an user is admin or not
        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'Forbidden' });
            }
        }
        // Authentication
        app.post('/login', async (req, res) => {
            const user = req.body;
            const accessToken = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: '1d'
            });
            res.send({ accessToken });
        })

        // To create payment intent
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret })
        });

        // To get data from service
        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray();
            res.send(services);
        });

        // to Get all user
        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        });

        // To add an user to database
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };

            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ result, token });
        });

        // To pick an user who have admin role
        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });
        })

        // To show all user with role (make an admin)
        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;

            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // Warning:
        // This is not the proper way to query.
        // After learning more about mongodb, use aggregate lookup, pipeline, match, group

        // to show available/remaining booking
        app.get('/available', async (req, res) => {
            const date = req.query.date;

            // step 1: get all services
            const services = await serviceCollection.find().toArray();

            // step 2: get the booking of that day. output: [{},{},{},{},{}]
            const query = { date: date };
            const booking = await bookingCollection.find(query).toArray();

            // step 3: for each service, find bookings for that service
            services.forEach(service => {
                // step 4: find bookings for that service. output: [{}, {}, {}]
                const serviceBookings = booking.filter(book => book.treatment === service.name);

                // step 5: select slots for the service Bookings: ['', '', '']
                const bookedSlots = serviceBookings.map(book => book.slot);

                // step 6: select those slots that are not in bookedSlots
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
                // step 7: set available to slots to make it easier
                service.slots = available;
            })

            res.send(services);
        })
        /**
         * API Naming Convention
         * app.get('/booking') // get all bookings in this collection, or get more than one or by filter
         * app.get('/booking/:id') // get a specific booking
         * app.post('/booking') // add a new booking
         * app.patch('/booking/:id') // update a specific booking
         * app.put('/booking/:id') // upsert ==> update(if exists) or insert (if doesn't exist)
         * app.delete('/booking/:id') // delete a specific booking
         */


        // to get all booking/appointment list
        // app.get('/appointment', async(req, res) =>{
        //     const query = {};
        //     const cursor = bookingCollection.find(query);
        //     const result = await cursor.toArray();
        //     res.send(result);
        // });

        // For Cancel/delete a booking
        app.delete('/booking/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await bookingCollection.deleteOne(query);
            if (result.deletedCount === 1) {
                console.log("Successfully deleted one booking.");
            }
            res.send(result);
        });

        // to get booking data of a particular patient
        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient;
            // const authorization = req.headers.authorization;
            // console.log('auth header', authorization);
            const decodedEmail = req.decoded.email;
            if (patient === decodedEmail) {
                const query = { patient: patient };
                const booking = await bookingCollection.find(query).toArray();
                res.send(booking);
            }
            else {
                return res.status(403).send({ message: 'Forbidden Access' });
            }

        });

        // to payment of an appointment
        app.get('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        });

        // to add a booking for appointment
        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient };
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking);
            sendAppointmentEmail(booking);
            return res.send({ success: true, result });
        });

        // To update an appointment as payment
        app.patch('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }

            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc);
            res.send(updatedDoc);
        });


        // To add a doctor
        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result);
        });

        // To manage doctor show all doctors
        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorCollection.find().toArray();
            res.send(doctors);
        });

        // To delete a doctor
        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email }
            const result = await doctorCollection.deleteOne(filter);
            res.send(result);
        });

    }
    finally {

    }
}
run().catch(console.dir);
app.get('/', (req, res) => {
    res.send('Hello Doctor Portal!')
})

app.listen(port, () => {
    console.log(`Doctors app listening on port ${port}`)
})