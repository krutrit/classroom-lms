# GitHub Pages + Apps Script API Design

## เป้าหมาย

ย้าย frontend ทั้งหน้ากระดานคะแนนและหน้าจัดการครูจาก Google Apps Script HTML Service ไปให้บริการผ่าน GitHub Pages ที่ URL `https://krutrit.github.io/classroom-lms/` โดยคง Google Apps Script เป็น JSON API และ Google Sheets เป็นฐานข้อมูล

## ขอบเขต

งานนี้ครอบคลุม:

- ย้ายหน้า `index.html` และ `teacher.html` ให้เป็น static frontend ที่ GitHub Pages ให้บริการได้
- เปลี่ยนการเรียก `google.script.run` ทั้งหมดเป็น HTTP requests ผ่าน `fetch()`
- เปลี่ยน Apps Script จาก HTML renderer เป็น allowlisted JSON API
- คง Google Sheet และข้อมูลทั้ง 7 ชีตเดิม
- คง Google Drive สำหรับรูปนักเรียน
- ใช้ session token ป้องกันหน้าครูและคำสั่งแก้ไขข้อมูล
- เพิ่ม GitHub Actions สำหรับ deploy GitHub Pages อัตโนมัติจาก `main`
- ทดสอบ CORS, API, frontend และการอ่าน/เขียนข้อมูลจริง

งานนี้ไม่ครอบคลุม:

- การย้ายฐานข้อมูลไป Firebase หรือฐานข้อมูลอื่น
- Cloudflare Worker หรือ proxy เพิ่มเติม
- Custom domain
- การเปลี่ยนดีไซน์หรือฟีเจอร์ธุรกิจที่ไม่เกี่ยวกับการย้าย hosting

## สถาปัตยกรรม

```text
GitHub repository: krutrit/classroom-lms
             |
             | GitHub Actions
             v
GitHub Pages static frontend
https://krutrit.github.io/classroom-lms/
             |
             | GET/POST with fetch()
             v
Google Apps Script JSON Web API
             |
             +-------------------+
             |                   |
             v                   v
       Google Sheets        Google Drive
       7 data sheets        student photos
```

GitHub Pages ให้บริการ HTML, CSS และ JavaScript เท่านั้น ไม่มี secret อยู่ใน frontend ส่วน Apps Script URL เป็น public configuration ที่สามารถเปิดเผยได้ตามธรรมชาติของเว็บ แต่ทุก action ที่มีสิทธิ์สูงต้องตรวจ session token ฝั่ง server

## โครงสร้างไฟล์เป้าหมาย

```text
/
├── index.html
├── teacher.html
├── assets/
│   ├── css/
│   │   ├── style.css
│   │   └── teacher.css
│   └── js/
│       ├── config.js
│       ├── api.js
│       ├── common.js
│       ├── index.js
│       └── teacher.js
├── apps-script/
│   ├── Code.gs
│   ├── Api.gs
│   ├── Auth.gs
│   ├── Data.gs
│   └── appsscript.json
├── tests/
├── docs/
├── .github/workflows/pages.yml
├── .clasp.json
├── .claspignore
└── README.md
```

ความรับผิดชอบของแต่ละส่วน:

- `assets/js/config.js` เก็บ Apps Script API URL ซึ่งไม่ใช่ secret
- `assets/js/api.js` ดูแล `fetch`, timeout, JSON parsing, error normalization และ token
- `assets/js/common.js` ดูแล toast, modal, HTML escaping และ helper ที่ใช้ร่วมกัน
- `assets/js/index.js` ดูแลหน้ากระดานและมินิเกม
- `assets/js/teacher.js` ดูแลหน้าเข้าสู่ระบบและทุกแท็บของครู
- `apps-script/Api.gs` ดูแล `doGet`, `doPost`, routing, request/response envelope
- `apps-script/Auth.gs` ดูแล password hash, rate limit และ teacher session
- `apps-script/Data.gs` ดูแล Sheets, Drive, validation และ business operations
- `apps-script/Code.gs` เก็บ setup และ utility ระดับ project

## รูปแบบ API

### Response สำเร็จ

```json
{
  "ok": true,
  "data": {}
}
```

### Response ผิดพลาด

```json
{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "กรุณาเข้าสู่ระบบใหม่"
  }
}
```

ข้อความ error ฝั่ง client เป็นภาษาไทยและไม่แสดง stack trace, token หรือรายละเอียดภายในระบบ

## API Routes

Apps Script ใช้ `action` เป็น route key และรับเฉพาะค่าที่อยู่ใน allowlist ไม่อนุญาตให้ client ส่งชื่อฟังก์ชันแล้วเรียกแบบ dynamic

### Public GET

| action | หน้าที่ |
|---|---|
| `health` | ตรวจสถานะ API และเวอร์ชัน |
| `publicData` | ส่งข้อมูลกระดานคะแนน |
| `dailyMinigame` | ส่งคำถามมินิเกมประจำวันที่เปิดอยู่ |

### Public POST

| action | หน้าที่ |
|---|---|
| `login` | ตรวจรหัสครูและสร้าง session token |
| `claimMinigame` | ตรวจคำตอบและบันทึกผู้รับโบนัส |

### Teacher POST

Teacher actions ทั้งหมดรับ `{ action, token, payload }` และตรวจ token ก่อนอ่านหรือเขียนข้อมูล

| กลุ่ม | actions |
|---|---|
| ข้อมูลรวม | `teacherDataFast`, `teacherData`, `minigameData` |
| การตั้งค่า | `updateSetting`, `changeTeacherPassword`, `logout` |
| นักเรียน | `addStudent`, `updateStudent`, `deleteStudent`, `restoreStudent`, `importStudents`, `uploadStudentPhoto` |
| งาน | `addAssignment`, `updateAssignment`, `deleteAssignment`, `restoreAssignment` |
| คะแนน | `saveScore`, `saveAllScores` |
| ตัวชี้วัด | `addIndicator`, `updateIndicator`, `deleteIndicator`, `exportScoresByIndicator` |
| มินิเกม | `addMinigameQuestion`, `updateMinigameQuestion`, `toggleMinigameQuestion`, `deleteMinigameQuestion`, `unblockMinigame`, `resetMinigameQuestion` |

คำสั่ง upload รูปรับ Base64 เฉพาะ MIME type `image/jpeg`, `image/png` และ `image/webp` พร้อมจำกัดขนาดก่อน decode

## Request Transport และ CORS

GET ใช้ query string เฉพาะค่าที่ไม่เป็นความลับ เช่น `action=publicData` ห้ามส่ง password หรือ token ผ่าน URL

POST ใช้:

```http
Content-Type: text/plain;charset=utf-8
```

Body เป็น JSON string วิธีนี้ทำให้ request อยู่ในกลุ่ม simple request และไม่ต้องส่ง `OPTIONS` preflight ซึ่ง Apps Script Web App ไม่มี route สำหรับจัดการโดยตรง

Client ใช้ `redirect: "follow"` เพราะ Apps Script Content Service redirect response ไปยัง `script.googleusercontent.com` ตามกลไกของ Google

ถ้า browser จาก GitHub Pages ไม่สามารถอ่าน response หลัง redirect ได้ในการทดสอบจริง งานจะหยุดก่อนเปิด Pages เป็น production และยกระดับไปใช้ proxy เป็นสเปกแยกต่างหาก ไม่ใช้ JSONP สำหรับ teacher API เพราะ token ไม่ควรถูกใส่ใน URL หรือ script tag

## Authentication และ Authorization

### Password

- รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร
- เก็บ salted SHA-256 hash ใน Script Properties
- ไม่เก็บ plaintext password ใน Google Sheet, GitHub, source หรือ URL
- การตั้งรหัสเริ่มต้นทำผ่าน owner-only setup flow

### Login

1. GitHub Pages ส่ง `{ action: "login", password }` ผ่าน POST body
2. Apps Script บังคับ rate limit 5 ครั้งต่อ 5 นาที
3. เมื่อถูกต้อง สร้าง token แบบสุ่ม
4. เก็บ session ใน CacheService อายุ 6 ชั่วโมง
5. Browser เก็บ token ใน `sessionStorage`
6. เมื่อ refresh tab session ยังอยู่ แต่ปิด tab/browser แล้ว session ฝั่ง browser หาย

### Teacher requests

- token อยู่ใน POST body เท่านั้น
- ทุก teacher route เรียก `requireTeacherSession(token)` ก่อนใช้ payload
- เมื่อได้ `UNAUTHORIZED` frontend ลบ tokenและกลับหน้าล็อกอิน
- Logout ลบทั้ง browser token และ server cache key
- เปลี่ยนรหัสผ่านแล้ว invalidate session ปัจจุบันและบังคับล็อกอินใหม่

## Validation และความปลอดภัย

- ตรวจชนิดข้อมูลทุก payload ก่อนเขียน
- จำกัดความยาวชื่อ, ห้อง, คำอธิบาย และคำถาม
- คะแนนต้องเป็นตัวเลข finite และอยู่ในช่วงที่งานกำหนด
- `student_id`, `assignment_id`, `indicator_id` ต้องอ้างอิง record ที่มีจริง
- ป้องกัน duplicate `student_code`
- Import จำกัดจำนวนแถวต่อ request และรายงานผลแยกรายการ
- ใช้ `LockService` กับการสร้าง ID, batch score, import และ claim มินิเกม
- ใช้ `textContent` หรือ `escapeHtml()` ก่อนนำข้อมูลจาก Sheet เข้า HTML
- ตรวจ photo URL protocol และ MIME type
- API error ไม่คืน exception detail ให้ client แต่บันทึกข้อมูลที่จำเป็นใน server log
- ไม่เปิด Spreadsheet เป็น Public; Web App API เป็นช่องทางเข้าถึงข้อมูลเพียงทางเดียว

## Frontend Migration

ไฟล์ HTML จะเปลี่ยน Apps Script template syntax เช่น `<?!= include(...) ?>` และ `<?= webAppUrl ?>` เป็น static tags และค่า configuration จาก `assets/js/config.js`

การเรียกเดิม:

```js
google.script.run
  .withSuccessHandler(renderPage)
  .getAllData();
```

เปลี่ยนเป็น:

```js
const data = await api.getPublicData();
renderPage(data);
```

ทุก action ในหน้าครูเรียกผ่าน method ที่ตั้งชื่อชัดเจนใน `api.js` ไม่มีการประกอบชื่อ method จาก input และไม่มีการเรียก Apps Script function โดยตรง

URL หน้าครูคือ `https://krutrit.github.io/classroom-lms/teacher.html` และไม่รับ password/token จาก query string

## GitHub Pages Deployment

ใช้ GitHub Actions workflow ที่ทำงานเมื่อ push เข้า `main`:

- checkout repository
- เตรียม Pages
- สร้าง artifact ที่มีเฉพาะ static frontend files
- upload artifact
- deploy ไป environment `github-pages`

Workflow ใช้ permissions ขั้นต่ำ:

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

Artifact ต้องไม่รวม `.clasp.json`, tests, Apps Script source, docs ภายใน และ credential ใด ๆ

## Apps Script Deployment

- Apps Script ยังคงเป็น container-bound กับ Google Sheet `classroom-lms`
- Execute as เจ้าของ `krutrit@gmail.com`
- Access เป็น Anyone
- deploy เป็น Web App เวอร์ชันใหม่หลัง API tests ผ่าน
- เก็บ deployment เดิมไว้เป็น fallback จน GitHub Pages ผ่าน smoke test
- API URL ที่ได้ถูกเพิ่มใน `assets/js/config.js`

## Error Handling

- `api.js` มี timeout และแยก network, timeout, parse และ API errors
- ปุ่มบันทึกป้องกัน double-submit และคืนสถานะเดิมเมื่อผิดพลาด
- batch operations คืนผลรายรายการและไม่รายงานว่าสำเร็จทั้งหมดเมื่อมีบางรายการล้มเหลว
- หน้า public แสดงปุ่มลองใหม่เมื่อ API ใช้งานไม่ได้
- หน้า teacher กลับไปล็อกอินเมื่อ session หมดอายุ
- การเรียกซ้ำที่เสี่ยงสร้างข้อมูลซ้ำต้องใช้ lock และตรวจ duplicate ฝั่ง server

## Testing

### Automated tests

- API router ส่งเฉพาะ action ที่อยู่ใน allowlist
- JSON response envelope ถูกต้องทั้ง success/error
- request ที่ JSON ไม่ถูกต้องถูกปฏิเสธ
- teacher action ที่ไม่มี/มี token ผิดถูกปฏิเสธก่อนแตะ storage
- password hash, rate limit, session creation, expiry และ logout
- validation ของนักเรียน งาน คะแนน และ import
- `api.js` จัดการ success, API error, timeout และ response ที่ parse ไม่ได้
- HTML rendering escape ค่าที่มาจาก Sheet

### Integration tests

- `health`, `publicData` และ `dailyMinigame` จาก Apps Script deployment จริง
- login และ teacher reads ด้วย session จริง
- เพิ่มข้อมูลทดสอบ บันทึกคะแนน และตรวจค่าบน Google Sheet
- ล้างเฉพาะข้อมูลทดสอบที่สร้างโดย test

### GitHub Pages smoke tests

- URL `https://krutrit.github.io/classroom-lms/` ตอบ HTTP 200
- หน้า public โหลดข้อมูลจริงจาก Apps Script ข้าม origin ได้
- หน้า teacher ล็อกอินและอ่านข้อมูลได้
- เพิ่ม/แก้/ซ่อนนักเรียน งาน คะแนน ตัวชี้วัด และคำถามได้
- รายงาน, Excel, PDF, รูป และมินิเกมยังทำงาน
- ทดสอบ desktop และ mobile viewport
- เปิด DevTools แล้วไม่มี CORS error, mixed content หรือ unhandled exception

## เกณฑ์สำเร็จ

1. GitHub Pages URL เปิดหน้า public ได้โดยไม่ล็อกอิน
2. ทั้ง `index.html` และ `teacher.html` ให้บริการจาก `krutrit.github.io`
3. ไม่มีการใช้ `google.script.run` หรือ Apps Script template syntax ใน frontend
4. Frontend ทุก action ติดต่อ Apps Script ผ่าน `api.js`
5. API อ่านและเขียน Google Sheet เดิมได้
6. ผู้ไม่มี session เรียก teacher action ไม่ได้
7. รหัสผ่านและ token ไม่ปรากฏใน URL, repository หรือ Sheet
8. GitHub Actions deploy สำเร็จจาก `main`
9. Automated tests ผ่านทั้งหมด
10. Smoke tests บน GitHub Pages ผ่านฟีเจอร์หลัก

## Rollback

หาก API หรือ GitHub Pages มีปัญหา:

- GitHub Pages rollback โดย revert commit หรือ deploy artifact จาก commit ล่าสุดที่ผ่าน
- Apps Script rollback โดยชี้ deployment กลับไปยัง version ก่อนหน้า
- deployment HTML Service เดิมยังคงอยู่จนกว่าจะยืนยัน production ใหม่แล้ว
- Google Sheet schema ไม่ถูกเปลี่ยนแบบทำลายข้อมูลใน migration นี้

## เอกสารอ้างอิง

- [Google Apps Script Web Apps](https://developers.google.com/apps-script/guides/web)
- [Google Apps Script Content Service](https://developers.google.com/apps-script/guides/content)
- [Google Apps Script Quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

