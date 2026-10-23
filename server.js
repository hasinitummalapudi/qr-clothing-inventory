require("dotenv").config();
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

app.get("/api/inventory", requireManager, async (req, res) => {
    try {
        const { data: products, error } = await supabase
            .from("products")
            .select("id, name, category, size, price, stock")
            .order("id", { ascending: true });

        if (error) {
            console.error("Inventory fetch error:", error.message);
            return res.status(500).json({
                message: "Unable to load inventory."
            });
        }

        const { data: salesData, error: salesError } = await supabase
            .from("sales")
            .select("product_id, quantity");

        if (salesError) {
            console.error("Sales fetch error:", salesError.message);
            return res.status(500).json({
                message: "Unable to load sales data."
            });
        }

        const inventoryWithSales = products.map(product => {
            const totalSold = salesData
                .filter(sale => sale.product_id === product.id)
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
    } catch (error) {
        console.error("Inventory error:", error.message);
        res.status(500).json({
            message: "Server error while loading inventory."
        });
    }
});

// ADD INVENTORY ITEM

app.post("/api/inventory", requireManager, async (req, res) => {
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

    try {
        const { data: newItem, error } = await supabase
            .from("products")
            .insert([{
                name: name.trim(),
                category: category.trim(),
                size: size.trim(),
                price: Number(price),
                stock: Number(stock)
            }])
            .select("id, name, category, size, price, stock")
            .single();

        if (error) {
            console.error("Add product error:", error.message);
            return res.status(500).json({
                message: "Unable to add product."
            });
        }

        res.json({
            message: "Item added successfully",
            item: newItem
        });
    } catch (error) {
        console.error("Add product error:", error.message);
        res.status(500).json({
            message: "Server error while adding product."
        });
    }
});

// DELETE PRODUCT

app.delete("/api/inventory/:id", requireManager, async (req, res) => {
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({
            message: "Invalid product ID."
        });
    }

    try {
        // Check whether the product exists
        const { data: product, error: fetchError } = await supabase
            .from("products")
            .select("id, name, category, size, price, stock")
            .eq("id", productId)
            .maybeSingle();

        if (fetchError) {
            console.error("Find product error:", fetchError.message);
            return res.status(500).json({
                message: "Unable to find product."
            });
        }

        if (!product) {
            return res.status(404).json({
                message: "Product not found."
            });
        }

        // Delete the product from Supabase
        const { error: deleteError } = await supabase
            .from("products")
            .delete()
            .eq("id", productId);

        if (deleteError) {
            console.error("Delete product error:", deleteError.message);
            return res.status(500).json({
                message: "Unable to delete product."
            });
        }

        res.json({
            message: "Product deleted successfully",
            product
        });
    } catch (error) {
        console.error("Delete product error:", error.message);
        res.status(500).json({
            message: "Server error while deleting product."
        });
    }
});


// DASHBOARD STATISTICS

app.get("/api/dashboard", requireManager, async (req, res) => {
    try {
        const { data: products, error: productsError } = await supabase
            .from("products")
            .select("id, stock");

        if (productsError) {
            console.error("Dashboard products error:", productsError.message);
            return res.status(500).json({
                message: "Unable to load dashboard products."
            });
        }

        const { data: salesData, error: salesError } = await supabase
            .from("sales")
            .select("product_id, quantity, total");

        if (salesError) {
            console.error("Dashboard sales error:", salesError.message);
            return res.status(500).json({
                message: "Unable to load dashboard sales."
            });
        }

        const totalProducts = products.length;

        const totalStock = products.reduce(
            (total, item) => total + item.stock,
            0
        );

        const totalSales = salesData.reduce(
            (total, sale) => total + Number(sale.total),
            0
        );

        const lowStock = products.filter(
            item => item.stock <= LOW_STOCK_LIMIT
        ).length;

        const lowSales = products.filter(product => {
            const totalSold = salesData
                .filter(sale => sale.product_id === product.id)
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
    } catch (error) {
        console.error("Dashboard error:", error.message);
        res.status(500).json({
            message: "Server error while loading dashboard."
        });
    }
});

// CREATE SALE

app.post("/api/sales", requireManager, async (req, res) => {
    const { productId, quantity } = req.body || {};

    const id = Number(productId);
    const saleQuantity = Number(quantity);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            message: "Invalid product ID."
        });
    }

    if (!Number.isInteger(saleQuantity) || saleQuantity <= 0) {
        return res.status(400).json({
            message: "Quantity must be a positive number."
        });
    }

    try {
        const { data: product, error: productError } = await supabase
            .from("products")
            .select("id, name, category, size, price, stock")
            .eq("id", id)
            .maybeSingle();

        if (productError) {
            console.error("Find product error:", productError.message);
            return res.status(500).json({
                message: "Unable to retrieve product."
            });
        }

        if (!product) {
            return res.status(404).json({
                message: "Product not found."
            });
        }

        if (product.stock < saleQuantity) {
            return res.status(400).json({
                message: "Not enough stock."
            });
        }

        const newStock = product.stock - saleQuantity;
        const saleTotal = Number(product.price) * saleQuantity;

        // Update the product stock in Supabase
        const { data: updatedProduct, error: updateError } = await supabase
            .from("products")
            .update({ stock: newStock })
            .eq("id", id)
            .eq("stock", product.stock)
            .select("id")
            .maybeSingle();

        if (updateError) {
            console.error("Stock update error:", updateError.message);
            return res.status(500).json({
                message: "Unable to update product stock."
            });
        }

        if (!updatedProduct) {
            return res.status(409).json({
                message: "Stock changed. Please refresh and try again."
            });
        }

        // Save the sale in Supabase
        const { data: savedSale, error: saleError } = await supabase
            .from("sales")
            .insert([{
                product_id: product.id,
                product_name: product.name,
                quantity: saleQuantity,
                total: saleTotal
            }])
            .select("id, product_id, product_name, quantity, total, created_at")
            .single();

        if (saleError) {
            console.error("Save sale error:", saleError.message);

            // Restore stock if saving the sale fails
            const { error: restoreError } = await supabase
                .from("products")
                .update({ stock: product.stock })
                .eq("id", id)
                .eq("stock", newStock);

            if (restoreError) {
                console.error("Stock restore error:", restoreError.message);
            }

            return res.status(500).json({
                message: "Unable to save sale."
            });
        }

        res.json({
            message: "Sale completed successfully",
            sale: {
                id: savedSale.id,
                productId: savedSale.product_id,
                productName: savedSale.product_name,
                quantity: savedSale.quantity,
                total: Number(savedSale.total),
                date: savedSale.created_at
            }
        });
    } catch (error) {
        console.error("Sales error:", error.message);
        res.status(500).json({
            message: "Server error while processing sale."
        });
    }
});


// GET SALES

app.get("/api/sales", requireManager, async (req, res) => {
    try {
        const { data: salesData, error } = await supabase
            .from("sales")
            .select("id, product_id, product_name, quantity, total, created_at")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Fetch sales error:", error.message);
            return res.status(500).json({
                message: "Unable to load sales history."
            });
        }

        const formattedSales = salesData.map(sale => ({
            id: sale.id,
            productId: sale.product_id,
            productName: sale.product_name,
            quantity: sale.quantity,
            total: Number(sale.total),
            date: sale.created_at
        }));

        res.json(formattedSales);
    } catch (error) {
        console.error("Sales history error:", error.message);
        res.status(500).json({
            message: "Server error while loading sales history."
        });
    }
});


// PUBLIC QR CODE GENERATION

app.get("/api/product/:id/qr", async (req, res) => {
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({
            message: "Invalid product ID."
        });
    }

    try {
        const { data: product, error } = await supabase
            .from("products")
            .select("id, name, category, size, price, stock")
            .eq("id", productId)
            .maybeSingle();

        if (error) {
            console.error("QR product lookup failed:", error.message);
            return res.status(500).json({
                message: "Unable to load product details."
            });
        }

        if (!product) {
            return res.status(404).json({
                message: "Product not found."
            });
        }

        // Keep the existing QR URL unchanged
        const productURL =
            `https://qr-clothing-inventory.onrender.com/product.html?id=${product.id}`;

        const qrCode = await QRCode.toDataURL(productURL);

        res.json({
            product: {
                id: product.id,
                name: product.name,
                category: product.category,
                size: product.size,
                price: Number(product.price),
                stock: product.stock
            },
            qrCode
        });
    } catch (error) {
        console.error("QR generation failed:", error.message);

        res.status(500).json({
            message: "QR generation failed."
        });
    }
});
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
});