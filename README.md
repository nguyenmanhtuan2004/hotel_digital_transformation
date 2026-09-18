# Hotel Digital Transformation

A data-driven digital transformation project designed to replace manual handwritten logbooks with a centralized database, a streamlined front-desk web application, and interactive business intelligence dashboards for revenue optimization.

* **Live Demo:** [https://a26-hotel-pms.vercel.app/hotel_app/](https://a26-hotel-pms.vercel.app/hotel_app/)

---

## Business Context & Objectives

### 1. The Problem
A26 Hotel (District 1, Ho Chi Minh City) faced a disconnect between operational performance and financial results. Although the front-desk and service teams consistently met shift-level operational KPIs, actual net revenue and profitability stagnated. 

The underlying causes included:
* **Fragmented Record-Keeping:** Operational records were scattered across handwritten notebooks and disconnected Excel sheets.
* **Lack of Financial Visibility:** Decisions were driven by intuition rather than real-time data, with no direct visibility into net cash flows (*Net Revenue* after OTA commission deductions).
* **Data Inconsistencies:** High risk of human error, missing customer details, and unrecorded discrepancies between OTA vouchers and ledger entries.

### 2. The Solution
In partnership with SonDoong Labs, a lean 7-week digital transformation initiative was implemented to:
* **Centralize and clean** all historical and incoming booking data into a single source of truth.
* **Build a dedicated front-desk web app** to phase out manual handwritten logbooks and ensure error-free data capture.
* **Deploy interactive Power BI management dashboards** to monitor daily and monthly business health and guide pricing strategies.

### 3. Core Objectives
* **Revenue Growth:** Achieve a **+15% to +20% increase in Net Revenue** by reducing OTA commission drag and optimizing room occupancy.
* **Operational Excellence:** Establish a transparent, secure, and standardized data management process across all operational shifts.

---

## Project Highlights

This project follows an end-to-end data pipeline from raw record auditing to cloud data modeling, operational automation, and management reporting:

```
[Raw Sources: Ledgers, OTA Excel, Vouchers]
                     │
                     ▼ (Excel Cleansing, Deduplication & Pivot Tables)
           [Cleaned Dataset & Bottleneck Diagnosis]
                     │
                     ▼ (Star Schema Design)
           [Azure SQL Database (Fact & Dims)]
              │                           │
              ▼ (Azure DAB)               ▼ (Import Mode)
     [Front-Desk Web App]          [Power BI Operations Dashboards]
   (20-30s Error-free Entry)      (Daily/Monthly KPIs & Channel Mix)
```

---

## Core Pillars

### 1. Data Collection & Cleansing (Excel & Multi-Source)
* **Ingested & consolidated** raw booking records from disparate sources: handwritten shift logs, voucher screenshots, and OTA reports (Agoda, Booking.com).
* **Applied Excel functions & tools** (`Pivot Tables`, `COUNTIF`, `SUMIFS`, `IF`, and logic validation) to detect discrepancies, missing fields, duplicates, and isolate low-occupancy rooms and underperforming sales channels.

### 2. Cloud Data Modeling (Azure SQL & Star Schema)
* **Architected a 4-table Star Schema** to structure over 20 core booking and billing metrics:
  * **`FactBooking`**: Centralized financial records (Gross Revenue, Net Revenue, payment methods, commission deduction).
  * **`DimCustomer`**, **`DimRoom`**, **`DimChannel`**: Standardized dimensions for customer demographics, room matrices, and distribution channels.
* **Deployed on Azure SQL Database** as the single source of truth for both operational transactions and business analytics.

### 3. Front-Desk Web App & Azure Data API Builder (DAB)
* **Built a lightweight, responsive web application** using vanilla **HTML5, CSS3, and JavaScript**.
* **Configured Azure Data API Builder (DAB)** to automatically generate secure RESTful CRUD APIs directly from the database schema.
* **Streamlined check-in/out workflows (20–30s)** with automated input validation rules, completely phasing out manual notebooks and cutting operational mistakes.
* **Live Demo:** [https://a26-hotel-pms.vercel.app/hotel_app/](https://a26-hotel-pms.vercel.app/hotel_app/)

### 4. Interactive Power BI Dashboards
* **Built operational & executive Power BI dashboards** (Import Mode) connected to the data warehouse.
* **Monitored key hospitality metrics** at both daily and monthly grains:
  * **Occupancy Rate (%)** & Room Vacancy distribution.
  * **Average Daily Rate (ADR)** & **RevPAR**.
  * **Channel Mix (%)** (Direct/Walk-in vs. OTA) to optimize pricing strategies and reduce OTA commission drag.

---

## Tech Stack

| Domain | Technologies Used |
| :--- | :--- |
| **Data Processing & Audit** | Microsoft Excel (Pivot Tables, XLOOKUP, SUMIFS, Logic Formulas) |
| **Cloud & Database** | Azure SQL Database, Azure Data API Builder (DAB) |
| **Frontend Application** | HTML5, Vanilla CSS3, JavaScript (Fetch API, Responsive UI) |
| **Business Intelligence** | Microsoft Power BI (DAX, Star Schema Data Modeling, Interactive Visuals) |

---

## Repository Structure

```text
├── hotel_app/              # Front-desk web application
│   ├── index.html          # Web App UI for front-desk check-in/out
│   ├── app.js              # Business logic & Azure DAB API integration
│   ├── styles.css          # Responsive styling
│   └── dab-config.json     # Azure Data API Builder configuration
├── index.html              # Landing page / entry point
└── README.md               # Project documentation
```

---

## Author & Links

* **Live Demo:** [https://a26-hotel-pms.vercel.app/hotel_app/](https://a26-hotel-pms.vercel.app/hotel_app/)
* **GitHub:** [@nguyenmanhtuan2004](https://github.com/nguyenmanhtuan2004)
* **Project Repository:** [Hotel Digital Transformation](https://github.com/nguyenmanhtuan2004/hotel_digital_transformation)
