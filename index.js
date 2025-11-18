const { MongoClient, ServerApiVersion } = require('mongodb');
const express = require('express')
const cors = require("cors")
require('dotenv').config();
const app = express()
const port = process.env.PORT || 3000

// middlewear
app.use(express.json())
app.use(cors())



const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.8xsgmgv.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const myDB = client.db("zap-shift");
    const parcelsCollection = myDB.collection("parcelsCollection");


    // parcel api

    app.get("/parcel", async(req, res) => {
        const query = {};
        const {email} = req.query;
        if(email){
            query.senderEmail = email
        }

        const cursor = parcelsCollection.find(query);
        const result = await cursor.toArray();
        res.send(result)
    })

    app.post("/parcel", async(req, res) => {
        const parcel = req.body;
        const result = await parcelsCollection.insertOne(parcel);
        res.send(result)
    })








    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})