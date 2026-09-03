# Classroom LMS

ระบบกระดานคะแนนและจัดการห้องเรียนบน Google Apps Script โดยใช้ Google Sheets เป็นฐานข้อมูลและ Google Drive เก็บรูปนักเรียน

## ความสามารถหลัก

- กระดานคะแนนสาธารณะ แยกห้อง ค้นหา ดูอันดับและรายละเอียดการส่งงาน
- หน้าครูสำหรับจัดการนักเรียน งาน คะแนน ตัวชี้วัด รายงาน และมินิเกม
- Import/Export Excel, รายงาน PDF และกราฟสถิติ
- มินิเกมประจำวันพร้อมคะแนนโบนัส

รายละเอียดระบบและ schema อยู่ใน [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md)

## สถาปัตยกรรม

- Google Apps Script HTML Service ให้บริการหน้าเว็บ
- Container-bound Google Sheet เก็บข้อมูล 7 ชีต
- Google Drive เก็บรูปนักเรียน
- GitHub เก็บ source code เท่านั้น ไม่เก็บข้อมูลนักเรียนหรือ credential

## ข้อกำหนด

- Git
- GitHub CLI (`gh`)
- Node.js
- Google clasp (`clasp`)

## อัปเดต Apps Script

```powershell
clasp push
clasp version "describe the release"
clasp deploy --description "describe the release"
```

ไฟล์ `.clasp.json` เป็น configuration เฉพาะเครื่องและไม่ถูก commit

## การตั้งค่าครั้งแรก

หลังสร้าง Apps Script project ให้เปิด Apps Script editor แล้วรัน:

1. `setupDatabase()` เพื่อสร้างชีตและค่าเริ่มต้น
2. `setupTeacherPassword('รหัสผ่านที่ยาวอย่างน้อย 10 ตัวอักษร')` เพื่อกำหนดรหัสครู

อย่าเก็บรหัสผ่านจริงใน source code, README, terminal history หรือ Google Sheet

## ความเป็นส่วนตัว

Web App ถูกออกแบบให้หน้ากระดานคะแนนเปิดได้โดยไม่ต้องล็อกอิน Google โปรดใช้ข้อมูลที่ได้รับอนุญาตให้เผยแพร่เท่านั้น รูปนักเรียนที่แสดงบนหน้าเว็บต้องเข้าถึงผ่านลิงก์ได้

## ลิงก์ระบบ

- GitHub repository: จะเพิ่มหลังเผยแพร่
- [Google Spreadsheet](https://docs.google.com/spreadsheets/d/1Gy79zRiPikUgw9L909C7FBkkVOaIkIjeSpfg5OFeuPY/edit)
- [Apps Script editor](https://script.google.com/d/1vwKOo_e5TYNWFf7GU5GFIOz2kmDQ3OUnnY-hhlWHSyPkXqnddto35f5Q/edit)
- [Web App](https://script.google.com/macros/s/AKfycbyu_xU5D14gDEAyHleMe8UDvVggh4ZeC98leBciHqd1Eiik41jHRQDJjXpghKyYTziC/exec)
