# Classroom LMS Deployment Design

## เป้าหมาย

นำระบบ LMS/กระดานคะแนนปัจจุบันขึ้น Public GitHub repository ชื่อ `classroom-lms` สร้าง Google Sheet และ container-bound Google Apps Script project ใหม่ ใช้ Sheet เป็นฐานข้อมูล และ deploy เป็น Web App ที่ทุกคนซึ่งมีลิงก์สามารถเปิดหน้ากระดานคะแนนได้

## ขอบเขต

งานนี้ครอบคลุม:

- เตรียม repository และไฟล์ที่จำเป็นสำหรับ GitHub
- สร้าง Google Sheet และ Apps Script project ใหม่
- เชื่อม source code ในเครื่องกับ Apps Script ผ่าน `clasp`
- สร้างโครงสร้างฐานข้อมูลเริ่มต้นทั้ง 7 ชีต
- ปรับ authentication ของหน้าครูให้ตรวจสิทธิ์ฝั่ง server
- deploy และทดสอบ Web App
- เขียนคู่มือ setup, deploy และดูแลระบบ

งานนี้ไม่ครอบคลุม:

- การนำเข้าข้อมูลนักเรียนจริง
- การซื้อหรือผูก custom domain
- การสร้าง CI/CD ที่มี Google credential บน GitHub Actions
- การเปลี่ยน frontend เป็น GitHub Pages

## สถาปัตยกรรมที่เลือก

ใช้ Google Apps Script แบบ container-bound กับ Google Sheet เพราะ backend ปัจจุบันเรียก `SpreadsheetApp.getActiveSpreadsheet()` และ frontend ใช้ `google.script.run` ซึ่งทำงานโดยตรงใน Apps Script HTML Service

```text
Public GitHub repository
        |
        | source/version control
        v
Local project --clasp push--> Container-bound Apps Script
                                      |
                                      v
                              Google Sheet database
                                      |
                                      v
                             Deployed Apps Script Web App
```

GitHub ทำหน้าที่เก็บ source code และเอกสารเท่านั้น ไม่ได้ host หน้าเว็บจริง หน้าเว็บจะให้บริการจาก Apps Script Web App

## GitHub Repository

- ชื่อ repository: `classroom-lms`
- Visibility: Public
- Branch หลัก: `main`
- เพิ่ม `README.md` อธิบายระบบ โครงสร้างข้อมูล การติดตั้ง และ deployment
- เก็บ `appsscript.json` ใน repository
- ไม่ commit `.clasp.json`, `.clasprc.json`, credential, token, รหัสผ่านครู หรือข้อมูลนักเรียน
- เพิ่ม `.gitignore` ครอบคลุมไฟล์ credential, local configuration และไฟล์ชั่วคราว

ก่อน publish จะตรวจ source เพื่อไม่ให้มีข้อมูลลับหรือข้อมูลส่วนบุคคลติดไปกับ repository

## Google Sheet และฐานข้อมูล

สร้าง Spreadsheet ใหม่ชื่อ `classroom-lms` และสร้างชีตดังนี้:

1. `settings`
2. `students`
3. `assignments`
4. `scores`
5. `indicators`
6. `minigame`
7. `minigame_rewards`

แต่ละชีตจะมี header ตามที่ระบุใน `SYSTEM_OVERVIEW.md` โดยไม่มีข้อมูลนักเรียนตัวอย่าง ค่าเริ่มต้นใน `settings` ได้แก่:

| key | value |
|---|---|
| `school_name` | `กระดานคะแนนห้องเรียน` |
| `minigame_enabled` | `true` |
| `mg_interval_days` | `1` |
| `report_enabled` | `true` |

รหัสผ่านครูจะไม่ถูก hard-code หรือ commit ลง GitHub ผู้ดูแลจะกำหนดรหัสผ่านเริ่มต้นระหว่าง setup และเก็บเฉพาะ salted hash ใน Script Properties

## Apps Script Project

สร้าง Apps Script project แบบผูกกับ Spreadsheet ผ่าน `clasp` แล้ว push ไฟล์ต่อไปนี้:

- `code.gs`
- `index.html`
- `teacher.html`
- `style.html`
- `script.html`
- `appsscript.json`

Manifest จะกำหนด timezone เป็น `Asia/Bangkok` และ V8 runtime รวมถึง OAuth scopes เท่าที่จำเป็นสำหรับ Spreadsheet, Drive และการให้บริการ Web App

## Authentication และ Authorization

ระบบเดิมตรวจรหัสผ่านเฉพาะเพื่อเปิด UI และส่งรหัสผ่านผ่าน query string ซึ่งไม่เพียงพอ แบบใหม่จะใช้ flow ดังนี้:

1. ผู้ใช้กรอกรหัสผ่านในหน้าครู
2. Backend เปรียบเทียบ salted hash กับค่าที่เก็บใน Script Properties
3. เมื่อถูกต้อง Backend สร้าง session token แบบสุ่ม อายุจำกัด
4. เก็บ session ฝั่ง server ใน CacheService โดยผูกกับเวลา expiry
5. Browser เก็บ token ใน `sessionStorage` ไม่ใส่ใน URL
6. ทุก server function ที่อ่านข้อมูลเฉพาะครูหรือแก้ไขข้อมูลต้องรับ token และตรวจ token ก่อนทำงาน
7. ฟังก์ชันสาธารณะจำกัดเฉพาะการอ่านข้อมูลหน้ากระดานและ flow มินิเกมที่จำเป็น
8. เพิ่ม rate limiting สำหรับการลองรหัสผ่าน
9. Logout จะลบ token ใน Browser และ invalidate token ฝั่ง server

Mutation ที่ต้องป้องกันรวมถึงการเพิ่ม/แก้ไข/ลบนักเรียน งาน ตัวชี้วัด คะแนน คำถามมินิเกม การอัปโหลดรูป การ import และการแก้ settings

## Web App Deployment

กำหนด deployment ดังนี้:

- Execute as: เจ้าของ Apps Script
- Who has access: Anyone
- หน้าเริ่มต้น: กระดานคะแนนสาธารณะ
- หน้าครู: เปิดจากปุ่มเข้าสู่ระบบโดยไม่ส่งรหัสผ่านผ่าน URL

หลัง deploy จะบันทึก Web App URL ไว้ใน README เฉพาะเมื่อ URL นั้นไม่มี secret และทดสอบด้วย session ที่ไม่ได้ล็อกอิน Google

## ความเป็นส่วนตัว

แม้ Web App จะเปิดให้ทุกคนที่มีลิงก์เข้าถึงได้ แต่ข้อมูลนักเรียนถือเป็นข้อมูลส่วนบุคคล จึงกำหนดว่า:

- repository ไม่มีข้อมูลนักเรียนจริง
- Spreadsheet ไม่แชร์เป็น Public โดยตรง
- รูปนักเรียนยังจำเป็นต้องเปิดดูด้วยลิงก์เพื่อให้ Browser แสดงผลได้ แต่ต้องแจ้งข้อจำกัดนี้ใน README
- ผู้ดูแลควรใช้นามแฝงหรือข้อมูลที่ได้รับอนุญาต หากเผยแพร่ Web App สู่สาธารณะ
- ไม่แสดงรหัสนักเรียนเต็มบนหน้าสาธารณะเกินกว่าที่ flow มินิเกมจำเป็นต้องใช้

## การจัดการข้อผิดพลาด

- การเรียก backend ที่ token ไม่ถูกต้องคืน error code `UNAUTHORIZED` และพากลับหน้าล็อกอิน
- การเขียนหลายรายการคืนผลรายรายการและไม่รายงานว่าสำเร็จหากมีบางรายการล้มเหลว
- การสร้าง ID และการเขียนข้อมูลสำคัญใช้ `LockService`
- การ setup ชีตสามารถเรียกซ้ำได้โดยไม่สร้าง header หรือค่า setting ซ้ำ
- หน้าเว็บแสดงข้อความที่อ่านเข้าใจได้ แต่ไม่เผย stack trace หรือ credential

## การทดสอบและเกณฑ์สำเร็จ

ถือว่างานสำเร็จเมื่อผ่านรายการต่อไปนี้:

1. GitHub repository `classroom-lms` เป็น Public และมี source/README ครบ
2. ไม่มี `.clasp.json`, token, password หรือข้อมูลนักเรียนใน Git history
3. Google Sheet ใหม่มีครบ 7 ชีตและ header ถูกต้อง
4. Apps Script source ตรงกับ source ใน GitHub
5. Web App URL เปิดหน้ากระดานได้โดยไม่ล็อกอิน Google
6. ผู้ใช้ที่ไม่มี teacher session เรียก mutation ไม่ได้
7. ครูล็อกอิน แก้ setting เพิ่มนักเรียน เพิ่มงาน และบันทึกคะแนนได้
8. ข้อมูลที่บันทึกปรากฏใน Google Sheet และหน้าแรกอ่านกลับมาได้
9. รหัสผ่านไม่ปรากฏใน URL, source code หรือ Sheet
10. มินิเกมและรายงานยังโหลดได้หลังปรับ authorization

## ขั้นตอนการส่งมอบ

ส่งมอบรายการต่อไปนี้:

- URL ของ Public GitHub repository
- URL ของ Google Sheet สำหรับเจ้าของ
- URL ของ Apps Script project
- URL ของ deployed Web App
- README พร้อมคำสั่ง update/deploy รอบถัดไป
- รายงานผล verification และข้อจำกัดที่ยังเหลือ

การสร้าง resource บน GitHub และ Google อาจเปิดหน้าต่างขอสิทธิ์ เจ้าของบัญชีต้องยืนยันสิทธิ์เมื่อระบบร้องขอ
