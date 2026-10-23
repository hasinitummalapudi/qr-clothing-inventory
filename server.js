
const express = require("express");
const cors = require("cors");
const path = require("path");
const QRCode = require("qrcode");
const session = require("express-session");
const { createClient } = require("@supabase/supabase-js");
const app = express();
const PORT = process.env.PORT || 3000;

// Render configuration
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json());
// Supabase database connection
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error("Supabase environment variables are missing.");
    process.exit(1);
}

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

console.log("Supabase client configured.");

supabase
    .from("products")
    .select("id")
    .limit(1)
    .then(({ data, error }) => {
        if (error) {
            console.error("Supabase connection test failed:", error.message);
        } else {
            console.log("Supabase database test successful!");
            console.log("Product records found:", data.length);
        }
    });

// Check session configuration before starting
if (!process.env.SESSION_SECRET) {
    console.error("STARTUP ERROR: SESSION_SECRET is missing.");
    console.error(
        "Add SESSION_SECRET in your Render web service Environment settings."
    );
    process.exit(1);
}

console.log("SESSION_SECRET is configured.");

app.use(session({
    name: "manager.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 2 * 60 * 60 * 1000
    }
}));

// INVENTORY DATA
let inventory = [
    {
        id: 1,
        name: "Black T-Shirt",
        category: "T-Shirt",
        size: "M",
        price: 799,
        stock: 20
    },
    {
        id: 2,
        name: "Blue Jeans",
        category: "Jeans",
        size: "30",
        price: 1499,
        stock: 15
    }
];

// SALES DATA
let sales = [];

const LOW_STOCK_LIMIT = 5;
const LOW_SALES_LIMIT = 5;
const MODERATE_SALES_LIMIT = 15;

// MANAGER LOGIN PAGE
app.get("/login.html", (req, res) => {
    if (req.session.managerAuthenticated) {
        return res.redirect("/");
    }

    res.sendFile(path.join(__dirname, "public", "login.html"));
});

// MANAGER LOGIN
app.post("/api/login", (req, res) => {
    const { username, password } = req.body || {};

    if (
        !process.env.MANAGER_USERNAME ||
        !process.env.MANAGER_PASSWORD
    ) {
        return res.status(500).json({
            message: "Manager login settings are not configured."
        });
    }

    if (
        typeof username !== "string" ||
        typeof password !== "string" ||
        username !== process.env.MANAGER_USERNAME ||
        password !== process.env.MANAGER_PASSWORD
    ) {
        return res.status(401).json({
            message: "Incorrect username or password."
        });
    }

    req.session.regenerate((error) => {
        if (error) {
            console.error("Session regeneration failed:", error);
            return res.status(500).json({
                message: "Unable to start your session."
            });
        }

        req.session.managerAuthenticated = true;

        req.session.save((saveError) => {
            if (saveError) {
                console.error("Session save failed:", saveError);
                return res.status(500).json({
                    message: "Unable to save your session."
                });
            }

            res.json({ message: "Login successful." });
        });
    });
});

// MANAGER LOGOUT
app.post("/api/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            return res.status(500).json({
                message: "Logout failed."
            });
        }

        res.clearCookie("manager.sid", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/"
        });

        res.json({ message: "Logged out successfully." });
    });
});

// PROTECT MANAGER PAGES
app.get("/", (req, res) => {
    if (!req.session.managerAuthenticated) {
        return res.redirect("/login.html");
    }

    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/index.html", (req, res) => {
    if (!req.session.managerAuthenticated) {
        return res.redirect("/login.html");
    }

    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// PUBLIC STATIC FILES, INCLUDING product.html
app.use(express.static(path.join(__dirname, "public"), {
    index: false
}));

// AUTHENTICATION CHECK FOR MANAGER APIS
function requireManager(req, res, next) {
    if (req.session &&
        req.session.managerAuthenticated === true) {
        return next();
    }

    return res.status(401).json({
        message: "Please log in as the manager first."
    });
}

// GET INVENTORY
app.get("/api/inventory", requireManager, (req, res) => {
    const inventoryWithSales = inventory.map(product => {
        const totalSold = sales
            .filter(sale => sale.productId === product.id)
            .reduce((total, sale) => total + sale.quantity, 0);

        let stockStatus;

        if (product.stock === 0) {
            stockStatus = "Out of Stock";
        } else if (product.stock <= LOW_STOCK_LIMIT) {
            stockStatus = "Low Stock";
        } else {
            stockStatus = "In Stock";
        }

        let salesStatus;

        if (totalSold <= LOW_SALES_LIMIT) {
            salesStatus = "Low Sales";
        } else if (totalSold <= MODERATE_SALES_LIMIT) {
            salesStatus = "Moderate Sales";
        } else {
            salesStatus = "Good Sales";
        }

        return {
            ...product,
            totalSold,
            stockStatus,
            salesStatus
        };
    });

    res.json(inventoryWithSales);
});

// ADD INVENTORY ITEM
app.post("/api/inventory", requireManager, (req, res) => {
    const { name, category, size, price, stock } = req.body || {};

    if (
        !name ||
        !category ||
        !size ||
        price === undefined ||
        stock === undefined ||
        !Number.isFinite(Number(price)) ||
        !Number.isInteger(Number(stock)) ||
        Number(price) < 0 ||
        Number(stock) < 0
    ) {
        return res.status(400).json({
            message: "Enter valid product details."
        });
    }

    const newId = inventory.length > 0
        ? Math.max(...inventory.map(item => item.id)) + 1
        : 1;

    const newItem = {
        id: newId,
        name,
        category,
        size,
        price: Number(price),
        stock: Number(stock)
    };

    inventory.push(newItem);

    res.json({
        message: "Item added successfully",
        item: newItem
    });
});

// DELETE PRODUCT
app.delete("/api/inventory/:id", requireManager, (req, res) => {
    const productId = Number(req.params.id);

    const productIndex = inventory.findIndex(
        item => item.id === productId
    );

    if (productIndex === -1) {
        return res.status(404).json({
            message: "Product not found"
        });
    }

    const deletedProduct = inventory[productIndex];
    inventory.splice(productIndex, 1);

    res.json({
        message: "Product deleted successfully",
        product: deletedProduct
    });
});

// DASHBOARD STATISTICS
app.get("/api/dashboard", requireManager, (req, res) => {
    const totalProducts = inventory.length;

    const totalStock = inventory.reduce(
        (total, item) => total + item.stock,
        0
    );

    const totalSales = sales.reduce(
        (total, sale) => total + sale.total,
        0
    );

    const lowStock = inventory.filter(
        item => item.stock <= LOW_STOCK_LIMIT
    ).length;

    const lowSales = inventory.filter(product => {
        const totalSold = sales
            .filter(sale => sale.productId === product.id)
            .reduce((total, sale) => total + sale.quantity, 0);

        return totalSold <= LOW_SALES_LIMIT;
    }).length;

    res.json({
        totalProducts,
        totalStock,
        totalSales,
        lowStock,
        lowSales
    });
});

// CREATE SALE
app.post("/api/sales", requireManager, (req, res) => {
    const { productId, quantity } = req.body || {};

    const product = inventory.find(
        item => item.id === Number(productId)
    );

    if (!product) {
        return res.status(404).json({
            message: "Product not found"
        });
    }

    const saleQuantity = Number(quantity);

    if (!Number.isInteger(saleQuantity) || saleQuantity <= 0) {
        return res.status(400).json({
            message: "Quantity must be a positive number."
        });
    }

    if (product.stock < saleQuantity) {
        return res.status(400).json({
            message: "Not enough stock."
        });
    }

    product.stock -= saleQuantity;

    const sale = {
        id: sales.length > 0
            ? Math.max(...sales.map(item => item.id)) + 1
            : 1,
        productId: product.id,
        productName: product.name,
        quantity: saleQuantity,
        total: product.price * saleQuantity,
        date: new Date().toLocaleString()
    };

    sales.push(sale);

    res.json({
        message: "Sale completed successfully",
        sale
    });
});

// GET SALES
app.get("/api/sales", requireManager, (req, res) => {
    res.json(sales);
});

// PUBLIC QR CODE GENERATION
app.get("/api/product/:id/qr", async (req, res) => {
    const productId = Number(req.params.id);

    const product = inventory.find(
        item => item.id === productId
    );

    if (!product) {
        return res.status(404).json({
            message: "Product not found"
        });
    }

    try {
        const productURL =
            `https://qr-clothing-inventory.onrender.com/product.html?id=${product.id}`;

        const qrCode = await QRCode.toDataURL(productURL);

        res.json({
            product: {
                id: product.id,
                name: product.name,
                category: product.category,
                size: product.size,
                price: product.price,
                stock: product.stock
            },
            qrCode
        });
    } catch (error) {
        console.error("QR generation failed:", error);

        res.status(500).json({
            message: "QR generation failed"
        });
    }
});

// START SERVER
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
});
