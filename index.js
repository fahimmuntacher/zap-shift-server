const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const crypto = require("crypto");
const stripe = require("stripe")(process.env.STRIPE_API_KEY);
const app = express();
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;

const serviceAccount = require("./firebase-admin-sdk-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  const time = Date.now().toString(36).toUpperCase();
  const randomHash = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `PKG-${time}-${randomHash}`;
}

// middlewear
app.use(express.json());
app.use(cors());

const verifyFireBaseToke = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "unauthorized acces" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    console.log("decoded in the token", decoded);
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
};

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
    const usersCollection = myDB.collection("usersCollections");
    const parcelsCollection = myDB.collection("parcelsCollection");
    const paymentCollection = myDB.collection("paymentCollections");
    const ridersCollection = myDB.collection("ridersCollections");

    // riders releated api

    app.post("/riders", async (req, res) => {
      const riderDetail = req.body;
      riderDetail.status = "pending";
      riderDetail.createdAt = new Date();

      // const existedRider = await ridersCollection.findOne(
      //   riderDetail?.riderEmail
      // );
      // if (existedRider) {
      //   return res.send({ message: "Rider is assigned" });
      // }

      const result = await ridersCollection.insertOne(riderDetail);
      res.send(result);
    });

    app.get("/riders", async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.stauts = req.query.status;
      }
      const cursor = ridersCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });
    // user reletade apis

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();

      const email = user?.email;
      const userExist = await usersCollection.findOne({ email });
      if (userExist) {
        return res.send({ message: "user exist" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

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
      parcel.createdAt = new Date();
      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    });

    app.delete("/parcel/:id", async (req, res) => {
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
        customer_email: paymentInfo?.customerEmail,
        metadata: {
          parcelId: paymentInfo?.parcelId,
          parcelName: paymentInfo?.parcelName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success/{CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
      });

      res.send({ url: session.url });
    });

    // old
    // app.post("/create-checkout-session", async (req, res) => {
    //   const paymentInfo = req.body;
    //   console.log(paymentInfo);
    //   const amount = parseInt(paymentInfo.cost) * 100;
    //   const session = await stripe.checkout.sessions.create({
    //     line_items: [
    //       {
    //         price_data: {
    //           currency: "USD",
    //           unit_amount: amount,
    //           product_data: {
    //             name: paymentInfo?.parcelName,
    //             metadata: paymentInfo.parcelId,
    //           },
    //         },
    //         quantity: 1,
    //       },
    //     ],
    //     customer_email: paymentInfo.senderEmail,
    //     mode: "payment",
    //     success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
    //     cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
    //   });
    //   console.log(session);
    //   res.send({ url: session.url });
    // });

    // stripe gateway
    app.patch("/payment-success/:sessionId", async (req, res) => {
      try {
        const { sessionId } = req.params;
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        console.log(session);
        const transactionId = session.payment_intent;

        // Check existing payment
        const paymentExist = await paymentCollection.findOne({ transactionId });
        if (paymentExist) {
          return res.send({
            message: "transaction already exist",
            transactionId,
            trackingId: paymentExist.trackingId,
          });
        }

        const trackingId = generateTrackingId();

        if (session.payment_status === "paid") {
          const parcelId = session.metadata.parcelId;

          // Update parcel
          await parcelsCollection.updateOne(
            { _id: new ObjectId(parcelId) },
            {
              $set: {
                paymentStatus: "Paid",
                trackingId,
                createdAt: new Date().toISOString(),
              },
            }
          );

          // Payment object
          const payment = {
            amount: session.amount_total / 100,
            currency: session.currency,
            parcelId: session.metadata.parcelId,
            parcelName: session.metadata.parcelName,
            customerEmail: session.customer_email,
            transactionId,
            trackingId,
            paymentStatus: session.payment_status,
            paidAt: new Date(),
          };

          const resultPayment = await paymentCollection.insertOne(payment);

          return res.send({
            success: true,
            trackingId,
            transactionId,
            paymentInfo: resultPayment,
          });
        }

        return res.send({ message: false });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: err.message });
      }
    });

    // payment related apis

    app.get("/payments", verifyFireBaseToke, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (query) {
        query.customerEmail = email;

        // verify email
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }
      const curosr = paymentCollection.find(query);
      const result = await curosr.toArray();
      res.send(result);
    });

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
