const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_API_KEY);
const app = express();
const port = process.env.PORT || 3000;

// middlewear
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.8xsgmgv.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const myDB = client.db("zap-shift");
    const parcelsCollection = myDB.collection("parcelsCollection");
    const paymentCollection = myDB.collection("paymentCollections")

    // parcel api

    app.get("/parcel", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }

      const cursor = parcelsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/parcel/:id", async (req, res) => {
      const id = req.params;
      const query = { _id: new ObjectId(id) };
      const cursor = await parcelsCollection.findOne(query);
      res.send(cursor);
    });

    app.post("/parcel", async (req, res) => {
      const parcel = req.body;
      // parcel created time
      parcel.createdAt = new Date().toDateString();
      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    });

    app.delete("/parcel/:id", async (req, res) => {
      console.log(req.params);
      const id = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.deleteOne(query);
      res.send(result);
    });

    // stripe integration

    // new with session
    app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo?.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        customer_email: paymentInfo.senderEmail,
        metadata : {
          parcelId : paymentInfo.parcelId,
          parcelName : paymentInfo?.parcelName
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success/{CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
      });

      res.send({url : session.url})
    });

    // old
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      console.log(paymentInfo);
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo?.parcelName,
                metadata: paymentInfo.parcelId,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: "payment",
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
      });
      console.log(session);
      res.send({ url: session.url });
    });

    // parcel patch
    app.patch(`/payment-success/:sessionId`, async (req, res) => {
      const {sessionId} = req.params;
      console.log("session id",sessionId);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if(session.payment_status === "paid"){
        const id = session. metadata.parcelId;
        const query = {_id : new ObjectId(id)};
        const update = {
          $set: {
            paymentStatus : "Paid",
            createdAt: new Date().toDateString()
          }
        }
        const result = await parcelsCollection.updateOne(query, update)

        const payment = {
          amount : session.amount_total / 100,
          currency: session.currency,
          parcelName : session.parcelName,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus : session.payment_status,
          paidAt : new Date()
        }

        if(session.payment_status === "paid"){
          const resultPayment = await paymentCollection.insertOne(payment);
          res.send({success : true, modifyParcel: result, paymentInfo : resultPayment})
        }
      }
      console.log(session);
      res.send({message: false})
    })
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
