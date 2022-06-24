const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

//TEMPLATE STRING
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nbzps.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });
// console.log(uri);

async function run() {
    try {
        await client.connect();
        // console.log('Database connected');
        const serviceCollection = client.db('doctors_portal').collection('services');

        // To get data from service
        app.get('/service', async(req, res) =>{
            const query = {};
            const cursor = serviceCollection.find(query);
            const services = await cursor.toArray();
            res.send(services);
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