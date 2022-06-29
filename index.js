const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
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
    })
}

//TEMPLATE STRING
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nbzps.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });
// console.log(uri);

async function run() {
    try {
        await client.connect();
        // console.log('Database connected');
        const serviceCollection = client.db('doctors_portal').collection('services');
        const bookingCollection = client.db('doctors_portal').collection('booking');
        const userCollection = client.db('doctors_portal').collection('users');

        // Authentication
        app.post('/login', async (req, res) => {
            const user = req.body;
            const accessToken = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: '1d'
            });
            res.send({ accessToken });
        })

        // To get data from service
        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query);
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
        app.get('/admin/:email', async(req, res) =>{
            const email = req.params.email;
            const user = await userCollection.findOne({email: email});
            const isAdmin = user.role === 'admin';
            res.send({admin: isAdmin});
        })

        // To show all user with role (make an admin)
        app.put('/user/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });

            if (requesterAccount.role === 'admin') {
                const filter = { email: email };
                const updateDoc = {
                    $set: { role: 'admin' },
                };
                const result = await userCollection.updateOne(filter, updateDoc);
                res.send(result);
            }
            else {
                res.status(403).send({ message: 'Forbidden' });
            }
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

        })


        // to add booking
        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient };
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking);
            return res.send({ success: true, result });
        })
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