# เว็บติวสอบ Final — Database Systems

สื่อการสอนเตรียมสอบ Final วิชาฐานข้อมูล (120 คะแนน) สรุปจากวิดีโอการสอนของอาจารย์ + แนวข้อสอบจากรุ่นพี่

## วิธีเปิดใช้งาน

เลือกวิธีใดวิธีหนึ่ง:

1. **เปิดไฟล์ตรง ๆ** — ดับเบิลคลิก `index.html` (ใช้งานได้เลย ไม่ต้องติดตั้งอะไร)
2. **ผ่านเว็บเซิร์ฟเวอร์** —
   ```bash
   cd เว็บติวสอบ-Final-DB
   python3 -m http.server 8793
   ```
   แล้วเปิด http://localhost:8793

อ่านได้ทั้งคอมและมือถือ (responsive) — บนมือถือใช้ปุ่ม ☰ มุมซ้ายบนเพื่อเปิดเมนู

## หน้าทั้งหมด

| ไฟล์ | หัวข้อ | คะแนน |
|---|---|---|
| `index.html` | หน้าแรก โครงข้อสอบ แผนอ่าน เช็คลิสต์ | — |
| `db-concept.html` | DB Concept: ฐานข้อมูล, DBMS, Key, Anomalies, 3-Tier | 10 |
| `normalization.html` | Normalization 1NF–3NF, BCNF, 4NF, 5NF | 40 |
| `recovery.html` | Transaction + ACID + Recovery Control (Log, UNDO/REDO) | 15 |
| `concurrency.html` | Concurrency Control (Lost Update, Locking, 2PL, Deadlock) | 15 |
| `data-warehouse.html` | Data Warehouse (ไม่ออกออกแบบ) | 15 |
| `sql.html` | SQL: Outer JOIN, Subquery, Correlated Subquery | 15 |
| `critique.html` | วิพากษ์ Data Model (3 โมเดล + สูตรตอบ) | 10 |

## ไฟล์ประกอบ

- `styles.css` — ธีมและ layout ทั้งเว็บ
- `script.js` — เมนูมือถือ, แถบความคืบหน้า, แบบทดสอบ (quiz), เช็คลิสต์ (เก็บใน localStorage)
- `tts.js` — ระบบเสียงช่วยอ่าน: ปุ่ม 🔊 หน้าหัวข้อ/หัวข้อย่อย/กล่องความรู้ + แถบควบคุมลอย
  - เสียงในเครื่อง (Web Speech API) — ถ้าเครื่องมีเสียงไทยจะใช้ก่อน
  - **เสียงไทยออนไลน์ (Google ผ่าน SoundOfText)** — สำหรับเครื่องที่ไม่มีเสียงไทยในตัว
    (ต้องต่ออินเทอร์เน็ต, ไม่ต้องใช้ API key, url เสียงถูกแคชไว้ใน localStorage อ่านซ้ำไวขึ้น)

เนื้อหาทั้งหมดเป็น static HTML — ไม่ต้อง build, ไม่มี dependency, ใช้ออฟไลน์ได้
(ฟอนต์ Noto Sans Thai โหลดจาก Google Fonts ถ้าออฟไลน์จะใช้ฟอนต์ระบบแทนอัตโนมัติ)
