const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const nodemailer = require("nodemailer");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { default: axios } = require("axios");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ccm0dfs.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
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
    // await client.connect();
    const userCollection = client.db("bossDb").collection("users");
    const menuCollection = client.db("bossDb").collection("menu");
    const cartCollection = client.db("bossDb").collection("carts");
    const paymentCollection = client.db("bossDb").collection("payments");
    const sslCollection = client.db("bossDb").collection("ssl");

    // jwt api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // verify token
    const verifyToken = (req, res, next) => {
      //   console.log("inside verify token", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
        if (error) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // verifyAdmin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //users api
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const exitingUser = await userCollection.findOne(query);
      if (exitingUser) {
        return res.send({ message: "user already exits", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // menu api
    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    app.post("/menu", async (req, res) => {
      const item = req.body;
      const result = await menuCollection.insertOne(item);
      res.send(result);
    });

    app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.findOne(query);
      res.send(result);
    });

    app.patch("/menu/:id", async (req, res) => {
      const item = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          name: item.name,
          category: item.category,
          price: item.price,
          recipe: item.recipe,
          ...(item.image && { image: item.image }), // Only update image if provided
        },
      };
      const result = await menuCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // cart api
    app.get("/carts", async (req, res) => {
      const result = await cartCollection.find().toArray();
      res.send(result);
    });

    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/carts", async (req, res) => {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);
    });

    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    //payment
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { price } = req.body;

        // Validate price
        if (!price || isNaN(price) || price <= 0) {
          return res.status(400).send({ error: "Invalid price value" });
        }

        const amount = Math.round(price * 100); // Convert to smallest currency unit
        console.log("Creating payment intent for amount (in cents):", amount);

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error("Error creating payment intent:", error.message);
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/payments/:email", verifyToken, async (req, res) => {
      const query = { email: req.params.email };
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);
      console.log("payments info", payment);

      // delete cart items
      const query = {
        _id: {
          $in: payment.cartIds.map((id) => new ObjectId(id)),
        },
      };
      const deleteResult = await cartCollection.deleteMany(query);

      // send email
      const userEmail = req.body.email;
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
      const mailOptions = {
        from: `'Bistro Boss' <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: "Payment Confirmation",
        text: `Dear customer, your payment of $${payment.price} has been successfully processed. Thank you for your purchase!`,
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error("Error sending email:", error);
        } else {
          console.log("Email sent: " + info.response);
        }
      });

      res.send({ paymentResult, deleteResult });
    });

    // ssl
    app.post("/create-payment", async (req, res) => {
      const paymentssl = req.body;
      const trxId = new ObjectId().toString();
      const initiateData = {
        store_id: "progr666c8685d9799",
        store_passwd: "progr666c8685d9799@ssl",
        total_amount: paymentssl.amount,
        currency: paymentssl.currency,
        tran_id: trxId,
        success_url: "http://localhost:3000/success-payment",
        fail_url: "http://localhost:3000/fail",
        cancel_url: "http://localhost:3000/cancle",
        cus_name: paymentssl.name,
        cus_email: paymentssl.email,
        cus_add1: "Dhaka",
        cus_add2: "Dhaka",
        cus_city: "Dhaka",
        cus_state: "Dhaka",
        cus_postcode: "1000",
        cus_country: "Bangladesh",
        cus_phone: "01711111111",
        cus_fax: "01711111111",
        shipping_method: "NO",
        product_name: "laptop",
        product_category: "topup",
        product_profile: "general",
        multi_card_name: "mastercard,visacard,amexcard",
        value_a: "ref001_A",
        value_b: "ref002_B",
        value_c: "ref003_C",
        value_d: "ref004_D",
      };
      const response = await axios({
        method: "POST",
        url: "https://sandbox.sslcommerz.com/gwprocess/v4/api.php",
        data: initiateData,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      const saveData = {
        cus_name: paymentssl.name,
        cus_email: paymentssl.email,
        paymentId: trxId,
        amount: paymentssl.amount,
        status: "pending",
        date: new Date(),
        cartIds: paymentssl.cartIds,
        menuItemIds: paymentssl.menuItemIds,
      };

      const save = await sslCollection.insertOne(saveData);
      //   console.log("resSSL", response);

      //   // delete cart items
      //   const query = {
      //     _id: {
      //       $in: paymentssl.cartIds.map((id) => new ObjectId(id)),
      //     },
      //   };
      //   const deleteResult = await cartCollection.deleteMany(query);

      if (save) {
        res.send({
          paymentUrl: response.data.GatewayPageURL,
        });
      }
    });

    app.post("/success-payment", async (req, res) => {
      const successData = req.body;
      if (successData.status !== "VALID") {
        throw new Error("Unauthorized payment, Invalid Payment");
      }

      // Update payment status
      const query = {
        paymentId: successData.tran_id,
      };
      const update = {
        $set: {
          status: "success",
        },
      };
      const updateData = await sslCollection.updateOne(query, update);

      // Delete cart items
      const carts = await sslCollection.findOne(query);
      if (carts) {
        const deleteQuery = {
          _id: { $in: carts.cartIds.map((id) => new ObjectId(id)) },
        };
        const deleteResult = await cartCollection.deleteMany(deleteQuery);
        console.log("Deleted cart items:", deleteResult);
      }

      res.redirect("http://localhost:5173/dashboard/cart");
    });

    app.post("/fail", async (req, res) => {
      res.redirect("http://localhost:5173/dashboard/cart");
    });

    app.post("/cancle", async (req, res) => {
      res.redirect("http://localhost:5173/dashboard/cart");
    });

    app.get("/ssl", async (req, res) => {
      const result = await sslCollection.find().toArray();
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
  res.send("boss is sitting");
});

app.listen(port, () => {
  console.log(`bistro boss is sitting on port ${port}`);
});
