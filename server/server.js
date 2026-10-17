require("dotenv").config();

const http = require("http");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error("ERROR: Supabase environment variables are missing.");
    process.exit(1);
}

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
);

const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
    );
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200);
        res.end(JSON.stringify({
            success: true,
            message: "Iceland Transfer server is running!"
        }));
        return;
    }

    if (req.url === "/api/bookings" && req.method === "POST") {
        let body = "";

        try {
            req.on("data", (chunk) => {
                body += chunk.toString();

                if (body.length > 100000) {
                    req.destroy();
                }
            });

            req.on("end", async () => {
                try {
                    const booking = JSON.parse(body);

                    const requiredFields = [
                        "full_name",
                        "email",
                        "phone",
                        "pickup_location",
                        "destination",
                        "pickup_date",
                        "pickup_time"
                    ];

                    for (const field of requiredFields) {
                        if (
                            typeof booking[field] !== "string" ||
                            !booking[field].trim()
                        ) {
                            res.writeHead(400);
                            res.end(JSON.stringify({
                                success: false,
                                message: `Missing or invalid field: ${field}`
                            }));
                            return;
                        }
                    }

                    const passengers = Number(booking.passengers ?? 1);
                    const luggage = Number(booking.luggage ?? 0);

                    if (
                        !Number.isInteger(passengers) ||
                        passengers < 1 ||
                        passengers > 100 ||
                        !Number.isInteger(luggage) ||
                        luggage < 0 ||
                        luggage > 100
                    ) {
                        res.writeHead(400);
                        res.end(JSON.stringify({
                            success: false,
                            message: "Invalid passengers or luggage count."
                        }));
                        return;
                    }

                    const email = booking.email.trim();

                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({
                            success: false,
                            message: "Please enter a valid email address."
                        }));
                        return;
                    }

                    const price =
                        booking.price === undefined ||
                        booking.price === null ||
                        booking.price === ""
                            ? null
                            : Number(booking.price);

                    if (
                        price !== null &&
                        (!Number.isFinite(price) || price < 0)
                    ) {
                        res.writeHead(400);
                        res.end(JSON.stringify({
                            success: false,
                            message: "Invalid booking price."
                        }));
                        return;
                    }

                    const newBooking = {
                        full_name: booking.full_name.trim(),
                        email: email,
                        phone: booking.phone.trim(),
                        pickup_location: booking.pickup_location.trim(),
                        destination: booking.destination.trim(),
                        pickup_date: booking.pickup_date,
                        pickup_time: booking.pickup_time,
                        passengers: passengers,
                        luggage: luggage,
                        flight_number: booking.flight_number
                            ? String(booking.flight_number).trim()
                            : null,
                        special_requests: booking.special_requests
                            ? String(booking.special_requests).trim()
                            : null,
                        price: price,
                        status: "pending"
                    };

                    const { data, error } = await supabase
                        .from("bookings")
                        .insert([newBooking])
                        .select("id, status, created_at")
                        .single();

                    if (error) {
                        console.error("Supabase booking error:", error.message);

                        res.writeHead(500);
                        res.end(JSON.stringify({
                            success: false,
                            message: "Could not save the booking. Please try again."
                        }));
                        return;
                    }

                    res.writeHead(201);
                    res.end(JSON.stringify({
                        success: true,
                        message: "Your booking has been received successfully!",
                        booking: data
                    }));
                } catch (error) {
                    res.writeHead(400);
                    res.end(JSON.stringify({
                        success: false,
                        message: "Invalid booking data."
                    }));
                }
            });

            req.on("error", () => {
                if (!res.writableEnded) {
                    res.writeHead(400);
                    res.end(JSON.stringify({
                        success: false,
                        message: "Could not read the request."
                    }));
                }
            });
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({
                success: false,
                message: "An unexpected server error occurred."
            }));
        }

        return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({
        success: false,
        message: "Page not found."
    }));
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Iceland Transfer server running on port ${PORT}`);
});
