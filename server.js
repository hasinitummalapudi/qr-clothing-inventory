const express = require("express");
const cors = require("cors");
const path = require("path");
const QRCode = require("qrcode");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   INVENTORY DATA
========================================================= */

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

/* =========================================================
   SALES DATA
========================================================= */

let sales = [];

/* =========================================================
   SETTINGS
========================================================= */

const LOW_STOCK_LIMIT = 5;

const LOW_SALES_LIMIT = 5;
const MODERATE_SALES_LIMIT = 15;

/* =========================================================
   HOME PAGE
========================================================= */

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================================================
   GET INVENTORY
========================================================= */

app.get("/api/inventory", (req, res) => {

    const inventoryWithSales = inventory.map(product => {

        // Calculate total quantity sold for this product
        const totalSold = sales
            .filter(sale => sale.productId === product.id)
            .reduce((total, sale) => total + sale.quantity, 0);

        // Stock status
        let stockStatus;

        if (product.stock === 0) {
            stockStatus = "Out of Stock";
        } 
        else if (product.stock <= LOW_STOCK_LIMIT) {
            stockStatus = "Low Stock";
        } 
        else {
            stockStatus = "In Stock";
        }

        // Sales status
        let salesStatus;

        if (totalSold <= LOW_SALES_LIMIT) {
            salesStatus = "Low Sales";
        } 
        else if (totalSold <= MODERATE_SALES_LIMIT) {
            salesStatus = "Moderate Sales";
        } 
        else {
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

/* =========================================================
   ADD INVENTORY ITEM
========================================================= */

app.post("/api/inventory", (req, res) => {

    const { name, category, size, price, stock } = req.body;

    if (!name || !category || !size || price === undefined || stock === undefined) {
        return res.status(400).json({
            message: "Please fill all product details"
        });
    }

    // Generate a unique ID
    const newId =
        inventory.length > 0
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

/* =========================================================
   DELETE PRODUCT
========================================================= */

app.delete("/api/inventory/:id", (req, res) => {

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

    // Remove product from inventory
    inventory.splice(productIndex, 1);

    /*
       IMPORTANT:
       We are NOT deleting the sales history.

       This means even if the product is removed from
       current inventory, previous sales remain available.
    */

    res.json({
        message: "Product deleted successfully",
        product: deletedProduct
    });
});

/* =========================================================
   DASHBOARD STATISTICS
========================================================= */

app.get("/api/dashboard", (req, res) => {

    const totalProducts = inventory.length;

    const totalStock = inventory.reduce(
        (total, item) => total + item.stock,
        0
    );

    const totalSales = sales.reduce(
        (total, sale) => total + sale.total,
        0
    );

    // Number of products with low stock
    const lowStock = inventory.filter(
        item => item.stock <= LOW_STOCK_LIMIT
    ).length;

    // Find products with low sales
    const lowSalesProducts = inventory.filter(product => {

        const totalSold = sales
            .filter(sale => sale.productId === product.id)
            .reduce(
                (total, sale) => total + sale.quantity,
                0
            );

        return totalSold <= LOW_SALES_LIMIT;
    });

    const lowSales = lowSalesProducts.length;

    res.json({
        totalProducts,
        totalStock,
        totalSales,
        lowStock,
        lowSales
    });
});

/* =========================================================
   CREATE SALE
========================================================= */

app.post("/api/sales", (req, res) => {

    const { productId, quantity } = req.body;

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
            message: "Quantity must be a positive number"
        });
    }

    if (product.stock < saleQuantity) {
        return res.status(400).json({
            message: "Not enough stock"
        });
    }

    // Reduce stock
    product.stock -= saleQuantity;

    const sale = {
        id: sales.length > 0
            ? Math.max(...sales.map(s => s.id)) + 1
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

/* =========================================================
   GET SALES
========================================================= */

app.get("/api/sales", (req, res) => {
    res.json(sales);
});

/* =========================================================
   GENERATE QR CODE FOR PRODUCT
========================================================= */

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
    `http://192.168.31.3:3000/product.html?id=${product.id}`;

        const qrCode =
            await QRCode.toDataURL(productURL);

        res.json({
            product,
            qrCode
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "QR generation failed"
        });
    }
});

/* =========================================================
   START SERVER
========================================================= */

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://192.168.31.3: ${PORT}`);
});