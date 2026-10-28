# Term 2 Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Artifact บน claude.ai สำหรับกำหนดเนื้อหาคณิตเทอม 2 รายห้อง แล้วส่งออกภาพ PNG สรุปรายครู

**Architecture:** เป็นหน้าเว็บ vanilla ES module ไม่มี build step แบ่งเป็น 3 ไฟล์
- `logic.js`: ฟังก์ชันล้วน ทดสอบด้วย `node --test`
- `app.js`: เรนเดอร์ UI และเชื่อมกับ `db`
- `index.html`: โครงหน้าและ CSS token

ข้อมูลอยู่ใน Artifact `db` (`classes/*`, `topics/*`, `meta/config`) ส่วน seed เขียนลง db ด้วย ArtifactData batch หลัง publish

**Tech Stack:** HTML/CSS/JS (ES2022 modules), Artifact capabilities `db` + `downloads` (runtime contract 0.2.92),
html2canvas 1.4.1 (`https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js`),
IBM Plex Sans Thai (Google Fonts), Node `node:test`, Playwright (ติดตั้งไว้แล้ว ห้ามติดตั้งใหม่)

**Spec:** `docs/superpowers/specs/2026-10-28-term2-planner-design.md`

## Global Constraints

- ข้อความ UI ทั้งหมดเป็นภาษาไทย ไม่ใช้ emoji เป็นไอคอน (ใช้ SVG inline เท่านั้น)
- เป้าหมายการแตะต้องมีขนาด ≥ 44×44px ฐานตัวอักษร 16px, line-height 1.6
- สี token บน `:root`: `--bg #FAFAF9`, `--card #FFFFFF`, `--fg #1C1917`, `--muted #57534E`, `--line #E7E5E4`, `--accent #0F766E`, `--on-accent #FFFFFF`, `--warn #C2410C`, `--danger #B91C1C`
  - โหมดมืดกำหนดใน `@media (prefers-color-scheme: dark)` ภายใต้ `:root:not([data-theme="light"])` และ `:root[data-theme="dark"]` ใช้ค่า `--bg #1C1917`, `--card #292524`, `--fg #F5F5F4`, `--muted #A8A29E`, `--line #44403C`, `--accent #5EEAD4`, `--on-accent #042F2E`, `--warn #FB923C`, `--danger #F87171`
- ใช้เส้นขอบ 1px แทนเงา ไม่มี gradient, transition 150–200ms และปิดเมื่อ `prefers-reduced-motion: reduce`
- ห้ามมี horizontal scroll ระดับหน้าที่ความกว้าง 375px
- ห้ามฝัง seed ในหน้าเว็บ db ว่างต้องแสดงข้อความ `ยังไม่มีข้อมูล`
- เขียน db เฉพาะตอนผู้ใช้กระทำ ห้ามเขียนตอน render หรือใน snapshot callback และเขียนเอกสารเดียวกันได้ทีละครั้ง (await ก่อนเขียนครั้งถัดไป)
- `courseType` มีค่าได้แค่ `"พื้นฐาน" | "เพิ่มเติม" | "เข้มข้น"` และ `status` มีค่าได้แค่ `"done" | "partial"`
- ภาพ PNG กว้าง 1600px ที่ scale 2 หัวข้อ `เนื้อหาคณิตศาสตร์เทอม 2 ปีการศึกษา 2569` และชื่อไฟล์ `term2-2569.png`

## Review Focus

1. **บันทึกลง db ไม่สำเร็จ** (`unavailable` หรือออฟไลน์): ค่าที่แก้ยังอยู่บนจอ แสดงแถบ `บันทึกไม่สำเร็จ` พร้อมปุ่ม `ลองใหม่` → Task 4
2. **ห้องอ้างถึง topicId ที่ไม่มีใน topics**: แสดง `(ไม่พบเรื่อง)` แทนที่จะพัง → Task 1 (`topicName`)
3. **เทอม 2 ยาว 10 เรื่องขึ้นไป**: PNG ยังกว้าง 1600px และข้อความตัดบรรทัดภายในเซลล์ ไม่ล้นออกนอกตาราง → Task 7
4. **ฟอนต์ยังโหลดไม่เสร็จตอนกดส่งออก**: ต้องรอ `document.fonts.ready` ก่อน html2canvas → Task 7
5. **เพิ่มเรื่องซ้ำในเทอม 2**: ตัวเลือกเรื่องต้องทำให้เรื่องที่เลือกแล้วกดไม่ได้ และ `addTopic` ต้องไม่เพิ่มซ้ำ → Task 1

---

## File Structure

```
term2-planner/
  index.html        โครงหน้า, CSS token, <script type="module" src="app.js">
  logic.js          ฟังก์ชันล้วน (export) ไม่แตะ DOM/db
  app.js            state, db wiring, render ทุกวิว, export PNG
  seed.json         ข้อมูลเริ่มต้นแบบย่อ (topics, sequences, classes)
  tools/seed-batch.mjs   แปลง seed.json → ops สำหรับ ArtifactData batch (stdout JSON)
  tests/logic.test.mjs   node --test
  tests/seed.test.mjs    node --test
  tests/mock-claude.js   window.claude mock (db + downloads in-memory) สำหรับ Playwright
  tests/ui.test.mjs      node --test + Playwright
package.json        {"type":"module","scripts":{"test":"node --test term2-planner/tests/"}}
```

---

### Task 1: `logic.js` — ฟังก์ชันล้วน

**Files:** Create `term2-planner/logic.js`, `term2-planner/tests/logic.test.mjs`, `package.json`

**Interfaces — Produces** (ทุกฟังก์ชัน export และไม่ mutate อาร์กิวเมนต์):
- `topicName(topicsById: Record<string,{name}>, id: string): string` คืนชื่อเรื่อง หรือ `"(ไม่พบเรื่อง)"` ถ้าไม่พบ id
- `groupByTeacher(classes: Class[]): {teacher: string, classes: Class[]}[]`
  - กลุ่มที่ teacher เป็นค่าว่างให้ใช้ชื่อ `"ยังไม่ระบุครู"` และอยู่ลำดับแรกเสมอ
  - กลุ่มอื่นเรียงตามชื่อด้วย `localeCompare(…, "th")`
  - ห้องในแต่ละกลุ่มเรียงตาม `school` แล้วตาม `room`
- `filterClasses(classes, filter: "all"|"review"|"พื้นฐาน"|"เพิ่มเติม"|"เข้มข้น"): Class[]`
- `term1Rows(sequence: string[], end: {topicId,status}): {topicId, state: "done"|"partial"|"end"|"untaught"}[]`
  - เรื่องก่อนหน้า `end.topicId` ได้ state `done`
  - เรื่องที่ตรงกับ `end.topicId` ได้ `end` ถ้า status เป็น done หรือได้ `partial` ถ้า status เป็น partial
  - เรื่องหลังจากนั้นได้ `untaught`
  - ถ้า `end.topicId` ไม่อยู่ใน sequence ทุกเรื่องได้ `untaught`
- `pickerGroups(cls: Class, sequences: Sequences, topics: Topic[], query: string): {key: "leftover"|"standard"|"other", title: string, items: {id, name, selected: boolean}[]}[]`
  - title ของแต่ละกลุ่มคือ `"เทอม 1 ที่ยังไม่ได้สอน"`, `"เทอม 2 มาตรฐาน (" + courseType + ")"` และ `"เรื่องอื่นทั้งหมด"`
  - กลุ่ม `leftover` คือเรื่องที่ `term1Rows` ให้ state `partial` หรือ `untaught`
  - เรื่องหนึ่งอยู่ได้ในกลุ่มแรกที่ตรงเท่านั้น
  - `query` กรองชื่อเรื่องแบบ substring (trim แล้ว) และไม่แสดงกลุ่มที่ว่าง
- `addTopic(list: string[], id: string): string[]` ถ้า id มีอยู่แล้วคืน list เดิม (ค่าเดิมตามเนื้อหา)
- `moveTopic(list: string[], index: number, delta: -1|1): string[]` ถ้าเลื่อนออกนอกขอบคืนสำเนาที่ไม่เปลี่ยน
- `removeTopicAt(list: string[], index: number): string[]`
- `slugifyTopic(name: string, existingIds: Set<string>): string` สร้าง `"t-" + base36(Date.now())` และเติม `-2`, `-3`… ถ้าชนกับ id ที่มีอยู่

`Class` = `{id, teacher, school, room, grade, courseType, term1End:{topicId,status,note}, term2TopicIds:string[], needsReview:boolean, updatedAt:number}`
`Sequences` = `{ "<courseType>": { "1": string[], "2": string[] } }`

- [ ] **Step 1: เขียน test ที่ fail** ใน `tests/logic.test.mjs` (ใช้ `node:test` + `node:assert/strict`) ครอบคลุมกรณีต่อไปนี้
  - `groupByTeacher` ได้กลุ่ม `"ยังไม่ระบุครู"` เป็นกลุ่มแรก และเรียงห้องตาม school/room
  - `filterClasses(…, "review")` คืนเฉพาะห้องที่ `needsReview`
  - `term1Rows(["a","b","c","d"], {topicId:"b",status:"partial"})` ได้ `["done","partial","untaught","untaught"]`
  - `term1Rows(…, {topicId:"zzz"})` ได้ `untaught` ทั้งหมด
  - `pickerGroups`: ห้องเพิ่มเติมที่จบ `polynomials-1` แบบ partial → กลุ่ม leftover มี `polynomials-1, equations-1, geometry-2d-3d, compass-construction`
    กลุ่ม standard มีเรื่องเทอม 2 ของเพิ่มเติมที่ไม่ซ้ำกับ leftover ถ้า item อยู่ใน `term2TopicIds` แล้วต้องได้ `selected:true`
    เมื่อ `query:"รูท"` เหลือเฉพาะกลุ่มที่มีรูท
  - `addTopic(["a"],"a")` ได้ `["a"]` และ `addTopic(["a"],"b")` ได้ `["a","b"]`
  - `moveTopic(["a","b","c"],0,-1)` ได้ `["a","b","c"]` และ `moveTopic(…,0,1)` ได้ `["b","a","c"]`
  - `removeTopicAt(["a","b"],0)` ได้ `["b"]`
  - `topicName({}, "x")` ได้ `"(ไม่พบเรื่อง)"`
  - ทุกฟังก์ชันไม่ mutate input (ตรวจด้วย `Object.freeze` ที่ input)
- [ ] **Step 2: รัน `npm test` แล้วต้อง FAIL** (หา module ไม่เจอ)
- [ ] **Step 3: เขียน `logic.js`** ให้ตรงกับ signature ข้างบน
- [ ] **Step 4: รัน `npm test` แล้วต้อง PASS ทุก test**
- [ ] **Step 5: Commit** `feat(term2-planner): pure planning logic`

### Task 2: `seed.json` + ตัวแปลงเป็น batch

**Files:** Create `term2-planner/seed.json`, `term2-planner/tools/seed-batch.mjs`, `term2-planner/tests/seed.test.mjs`

**Interfaces:**
- Consumes: รูปแบบ `Class`, `Sequences` จาก Task 1
- Produces:
  - `seed.json` = `{topics: {id,name,details:string[]}[], sequences: Sequences, classes: Omit<Class,"id"|"updatedAt"|"grade">[]}`
  - `export function toBatchOps(seed, now:number): {op:"set", path:string, data:object}[]` ใน `seed-batch.mjs`
    - ห้องได้ path `classes/c01` … `classes/c26` ตามลำดับ และ `grade:"ม.1"`
    - เรื่องได้ path `topics/<id>` และ sequences ได้ `meta/config` = `{sequences, schemaVersion:1}`
  - เมื่อรันตรง ๆ (`node term2-planner/tools/seed-batch.mjs`) ให้พิมพ์ JSON ของ ops ออก stdout

**ค่า topic id → ชื่อ** (ห้ามเปลี่ยน):
- `integers` จำนวนเต็ม · `decimals` ทศนิยม · `fractions` เศษส่วน · `exponents-1` เลขยกกำลัง (1) · `exponents-2` เลขยกกำลัง (2)
- `counting-numbers` จำนวนนับ · `polynomials-1` พหุนาม (1) · `polynomials-2` พหุนาม (2) · `polynomials-3` พหุนาม (3)
- `equations-1` สมการ (1) · `equations-2` สมการ (2) · `geometry-2d-3d` รูปเรขา 2 และ 3 มิติ · `compass-construction` การสร้างด้วยวงเวียนและสันตรง
- `applications-1` ประยุกต์ (1) · `ratio-percent` อัตราส่วน สัดส่วนร้อยละ · `linear-word-problems` โจทย์ปัญหาสมการตัวแปรเดียว
- `roots-1` รูท (1) · `roots-2` รูท (2) · `two-variable-equations` สมการสองตัวแปร · `two-variable-word-problems` โจทย์ปัญหาสมการสองตัวแปร
- `quadratic-equations` สมการกำลังสอง · `quadratic-equations-2` สมการกำลังสอง (2) · `quadratic-word-problems` โจทย์ปัญหาสมการกำลังสอง · `linear-graphs` กราฟและความสัมพันธ์เชิงเส้น

`details` คัดลอกจากแท็บรายละเอียดวิชา โดยจับคู่ดังนี้: "สมการตัวแปรเดียว(1)" → `equations-1`, "สมการตัวแปรเดียว(2)" → `equations-2` และ "สมการกำลังสอง(1)" → `quadratic-equations` เรื่องที่ไม่มีรายละเอียดให้ใช้ `[]`

**sequences:** ใช้ค่าในสเปก §2 (เนื้อหา69) และ §8 สำหรับเทอม 2
- พื้นฐาน เทอม 1 = `integers, decimals, fractions, exponents-1`
- เพิ่มเติม เทอม 1 = `counting-numbers, polynomials-1, equations-1, geometry-2d-3d, compass-construction`
- เข้มข้น เทอม 1 = `polynomials-1, equations-1, applications-1`

**classes:** คัดลอกตารางสเปก §8 ทั้ง 26 แถวตามลำดับ
- `needsReview` เป็น true เมื่อแถวนั้นมี ⚠
- `term1End.note` ใช้ข้อความในวงเล็บ ถ้าไม่มีวงเล็บให้เป็น `""`
- `term2TopicIds` = sequences[courseType]["2"]

- [ ] **Step 1: เขียน test ที่ fail** ใน `tests/seed.test.mjs`
  - `classes.length === 26`
  - จำนวนห้องที่ `needsReview` = 21
  - ทุก topicId ที่อ้างใน sequences, term1End และ term2TopicIds มีอยู่ใน topics
  - ทุก `courseType` และ `status` อยู่ในค่าที่อนุญาต
  - ห้องแรก = `{teacher:"นิราซฟัน มะแซ", school:"บ้านตาล", courseType:"เพิ่มเติม", term1End:{topicId:"equations-1",status:"done"}}`
  - ห้องที่ 8 มี `term1End.note === "ได้แค่บวกลบพหุนาม"`
  - `toBatchOps(seed, 1)` มี op ทั้งหมด `26 + topics.length + 1` ตัว, op แรก path `classes/c01` และมี path `meta/config`
- [ ] **Step 2: รันแล้วต้อง FAIL**
- [ ] **Step 3: เขียน `seed.json` และ `seed-batch.mjs`**
- [ ] **Step 4: รัน `npm test` แล้วต้อง PASS ทั้งหมด**
- [ ] **Step 5: Commit** `feat(term2-planner): seed data from term 1 sources`

### Task 3: Test harness สำหรับ UI + โครงหน้า + โหลดข้อมูล

**Files:** Create `term2-planner/index.html`, `term2-planner/app.js`, `term2-planner/tests/mock-claude.js`, `term2-planner/tests/ui.test.mjs`

**Interfaces:**
- Consumes: `logic.js` (Task 1) และ `toBatchOps` (Task 2) สำหรับเติมข้อมูลใน mock
- Produces:
  - `mock-claude.js` ใช้ผ่าน `page.addInitScript` แล้วกำหนด `window.__mock = {docs: Map<path,object>, failNextWrite: boolean, saved: {filename, size}[]}`
    และ `window.claude = {use(name)}` ที่ให้ `db` ซึ่งมี `collection(p).onSnapshot`, `doc(p).set/update/delete/get` ตามรูปแบบใน `db.d.ts`
    (snapshot มี `docs[].id`, `docs[].data()`) โดย `failNextWrite` ทำให้การเขียนครั้งถัดไป reject `{code:"unavailable"}`
    นอกจากนั้นให้ `downloads.save()` ที่บันทึกลง `saved`
  - `ui.test.mjs` มี helper `openPage({seed: boolean, width: number}) → {page, browser}`
    - เริ่ม static server ด้วย `node:http` ที่ serve โฟลเดอร์ `term2-planner/`
    - เมื่อ `seed: true` ให้เติม mock ด้วย ops จาก `toBatchOps`
    - ส่ง request ไปยัง fonts.googleapis และ cdnjs ต่อได้ตามปกติ แต่ถ้าโหลดไม่สำเร็จต้องไม่ทำให้ test ล้ม
  - `app.js` มี state เดียว `state = {classes: Class[], topics: Topic[], sequences, view: "list"|"summary", filter, editingId: string|null, saveError: null|{retry: () => Promise<void>}}`
    และ `render()` ที่วาดใหม่จาก state (event delegation บน `#app`)
  - subscribe `classes`, `topics` และ `meta/config` อย่างละ 1 ครั้งตอนเริ่ม

- [ ] **Step 1: เขียน test ที่ fail**
  - `empty db shows ยังไม่มีข้อมูล`
  - `seeded db shows 26 class rows` (นับ `[data-class-id]`)
  - `use("db") null shows เปิดใน claude.ai` (ตั้ง mock ให้คืน null)
  - `no horizontal scroll at 375px` (`scrollWidth <= innerWidth`)
- [ ] **Step 2: รันแล้วต้อง FAIL**
- [ ] **Step 3: เขียน `index.html`**
  - ใส่ `<title>Term 2 Planner</title>`, token ตาม Global Constraints และลิงก์ฟอนต์ IBM Plex Sans Thai 400/500/600
  - แท็บบนสุด `ห้องเรียน` / `สรุป` (`role="tablist"`) และ `<main id="app">`
- [ ] **Step 4: เขียน `app.js` ส่วน bootstrap, subscribe และสถานะ empty/null**
- [ ] **Step 5: รัน `npm test` แล้วต้อง PASS ทั้งหมด**
- [ ] **Step 6: Commit** `feat(term2-planner): page shell, db loading, UI test harness`

### Task 4: วิวรายการห้อง + การบันทึกที่ทนต่อความผิดพลาด

**Files:** Modify `term2-planner/app.js`, `term2-planner/index.html` (CSS), `term2-planner/tests/ui.test.mjs`

**Interfaces:**
- Consumes: `groupByTeacher`, `filterClasses`, `topicName`
- Produces: `async function saveClass(cls: Class): Promise<void>`
  - เรียก `db.doc("classes/"+cls.id).set({...cls, updatedAt: Date.now()})`
  - อัปเดต state ทันทีโดยไม่รอ snapshot
  - ถ้า reject ให้ตั้ง `state.saveError = {retry: () => saveClass(cls)}`
  - เขียนเอกสารเดียวกันได้ทีละครั้ง: ถ้ามีการบันทึกค้างอยู่ ให้เก็บเฉพาะค่าล่าสุดแล้วเขียนต่อเมื่อครั้งก่อนเสร็จ

UI:
- หัวกลุ่มเป็นชื่อครู
- แต่ละแถว (`data-class-id`) แสดง `โรงเรียน · ห้อง · ประเภท`, `จบ: <ชื่อเรื่อง>` (+ `ยังไม่จบ` ถ้า partial) และ `เทอม 2: n เรื่อง`
- ห้องที่ต้องตรวจมีป้าย `ต้องตรวจ` สีส้ม พร้อมไอคอนจุด
- chip ตัวกรอง `ทั้งหมด / ต้องตรวจ / พื้นฐาน / เพิ่มเติม / เข้มข้น` และปุ่ม `+ เพิ่มห้อง` ที่สร้างห้องว่าง
  (`courseType "เพิ่มเติม"`, `needsReview true`) แล้วเปิด editor
- แถบ `บันทึกไม่สำเร็จ` มีปุ่ม `ลองใหม่` (`role="alert"`)

- [ ] **Step 1: เขียน test ที่ fail**
  - `list groups by teacher` (มีหัวกลุ่ม `นิราซฟัน มะแซ`)
  - `filter ต้องตรวจ shows 21 rows`
  - `failed save keeps edit and retry succeeds`
    - ตั้ง `failNextWrite` แล้วกด `+ เพิ่มห้อง` จะเห็นแถบ `บันทึกไม่สำเร็จ`
    - กด `ลองใหม่` แล้ว `__mock.docs` มีห้องที่ 27
- [ ] **Step 2: รันแล้วต้อง FAIL**
- [ ] **Step 3: เขียน render ของ list และ `saveClass`**
- [ ] **Step 4: รัน `npm test` แล้วต้อง PASS ทั้งหมด**
- [ ] **Step 5: Commit** `feat(term2-planner): class list with filters and resilient save`

### Task 5: Editor — ข้อมูลห้อง + จุดจบเทอม 1

**Files:** Modify `app.js`, `index.html` (CSS), `tests/ui.test.mjs`

**Interfaces:**
- Consumes: `term1Rows`, `saveClass`
- Produces: `openEditor(id)` และ `closeEditor()` ที่ตั้งค่า `state.editingId`
  - บนจอเล็กกว่า 768px editor เป็น sheet เต็มจอ
  - บนจอ 768px ขึ้นไป editor เป็นแผงขวากว้าง 420px
  - ปุ่มปิดมี `aria-label="ปิด"`

UI section 1 (ข้อมูลห้อง):
- ช่อง `ครู` เป็น `<input list>` ที่มี datalist จากชื่อครูที่มีอยู่แล้ว
- ช่อง `โรงเรียน` และ `ห้อง`
- `<select>` ประเภทวิชา และสวิตช์ `ต้องตรวจ`
- บันทึกเมื่อเกิด `change` (ไม่บันทึกทุกครั้งที่พิมพ์)

UI section 2 `จบเทอม 1 ที่`:
- รายการจาก `term1Rows` แตะแถวเพื่อตั้ง `term1End.topicId`
- segmented control `จบแล้ว / ยังไม่จบ` และช่อง `หมายเหตุ`
- state `done` แสดงเครื่องหมายถูกสีเทา, `untaught` แสดงข้อความ `ยังไม่ได้สอน`

ปุ่ม `ลบห้อง` ต้องผ่าน `confirm()` ก่อน แล้วจึงเรียก `db.doc(...).delete()`

- [ ] **Step 1: เขียน test ที่ fail**
  - `edit teacher persists` (แก้ครูห้อง c03 แล้ว `__mock.docs.get("classes/c03").teacher` เปลี่ยน)
  - `set term1 end partial with note` (topicId, status และ note บันทึกครบ)
  - `delete class after confirm` (ใช้ `page.on("dialog", d => d.accept())`)
- [ ] **Step 2: รันแล้วต้อง FAIL**
- [ ] **Step 3: เขียน editor ส่วน 1–2**
- [ ] **Step 4: รัน `npm test` แล้วต้อง PASS ทั้งหมด**
- [ ] **Step 5: Commit** `feat(term2-planner): class editor for info and term 1 end`

### Task 6: Editor — เนื้อหาเทอม 2, ตัวเลือกเรื่อง, คัดลอกจากห้องอื่น

**Files:** Modify `app.js`, `index.html` (CSS), `tests/ui.test.mjs`

**Interfaces:**
- Consumes: `pickerGroups`, `addTopic`, `moveTopic`, `removeTopicAt`, `slugifyTopic`, `topicName`, `saveClass`
- Produces: ไม่มี interface ใหม่สำหรับ task ถัดไป

UI section 3 `เนื้อหาเทอม 2`:
- รายการลำดับ `1. <ชื่อ>` แต่ละแถวมีปุ่ม ↑ ↓ ✕ ที่มี `aria-label` = `เลื่อนขึ้น` / `เลื่อนลง` / `เอาออก`
  ปุ่มที่เลื่อนต่อไม่ได้ต้อง disabled
- ปุ่ม `+ เพิ่มเรื่อง` เปิดตัวเลือกเรื่อง (dialog) ที่มี
  - ช่องค้นหา (`<input type="search">` พร้อม label `ค้นหาเรื่อง`)
  - กลุ่มจาก `pickerGroups` โดย item ที่ `selected` ต้อง `disabled` และจางลง
  - แตะ item เพื่อเพิ่ม แล้ว dialog ยังเปิดอยู่เพื่อเพิ่มเรื่องอื่นต่อได้
  - ข้อความ `details` ของเรื่องแสดงเป็นบรรทัดเล็กใต้ชื่อ (สูงสุด 2 บรรทัด)
  - ถ้าค้นหาแล้วไม่พบ ให้แสดงปุ่ม `เพิ่ม "<คำค้น>" เป็นเรื่องใหม่` ที่สร้าง `topics/<slugifyTopic>` แล้วเพิ่มเข้า list ทันที
- ปุ่ม `คัดลอกจากห้องอื่น…` เปิด `<select>` รายชื่อห้องอื่น (`ครู — โรงเรียน ห้อง`)
  เมื่อเลือกแล้วต้องผ่าน `confirm("แทนที่เนื้อหาเทอม 2 ของห้องนี้?")` ก่อน แล้วจึงคัดลอก `term2TopicIds`

- [ ] **Step 1: เขียน test ที่ fail**
  - `add topic from picker` (เพิ่ม `polynomials-3` ให้ c01 แล้ว list ยาว 6)
  - `selected topic is disabled in picker`
  - `move and remove topic persist order`
  - `create new topic from search`
    - พิมพ์ `สถิติ` แล้วกดเพิ่ม จะได้ topics doc ใหม่ชื่อ `สถิติ`
    - topic ใหม่อยู่ท้าย list ของห้อง
  - `copy term2 from another class` (คัดลอกจาก c04 ไป c01 แล้วทั้งสองห้องเท่ากัน)
- [ ] **Step 2: รันแล้วต้อง FAIL**
- [ ] **Step 3: เขียน section 3, ตัวเลือกเรื่อง และการคัดลอก**
- [ ] **Step 4: รัน `npm test` แล้วต้อง PASS ทั้งหมด**
- [ ] **Step 5: Commit** `feat(term2-planner): term 2 topic picker, reorder, copy`

### Task 7: วิวสรุป + ส่งออก PNG

**Files:** Modify `app.js`, `index.html` (CSS + `<script src>` html2canvas), `tests/ui.test.mjs`

**Interfaces:**
- Consumes: `groupByTeacher`, `topicName`
- Produces: `async function exportPng(): Promise<Blob>` ทำงานตามลำดับนี้
  1. `await document.fonts.ready`
  2. สร้าง `#export-root` นอกจอ (`position:fixed; left:-10000px; width:1600px`) โดยใช้สีโหมดสว่างเสมอ
  3. `html2canvas(el, {scale: 2, backgroundColor: "#FFFFFF"})`
  4. ได้ `canvas.toBlob` แล้วลบ `#export-root`

ตารางสรุป (บนจอและในภาพ) ใช้โครงเดียวกัน:
- หัวภาพเป็นชื่อเรื่องตาม Global Constraints + `ข้อมูล ณ <วันที่ไทย>` (`toLocaleDateString("th-TH")`)
- คอลัมน์ `ครู | โรงเรียน · ห้อง | ประเภท | จบเทอม 1 | เทอม 2`
  - คอลัมน์เทอม 2 แสดงลิสต์ `1. … 2. …` แบบตัดบรรทัด (`flex-wrap`) แทนการแยกคอลัมน์ต่อเรื่อง เพื่อให้ความกว้างคงที่ไม่ว่าจะมีกี่เรื่อง
- ชื่อครูแสดงเฉพาะแถวแรกของกลุ่ม และมีเส้นแบ่งกลุ่ม
- ถ้ามีห้องที่ `needsReview` หรือยังไม่มีครู ให้แสดงแถบเตือน `มี n ห้องที่ยังต้องตรวจ` เหนือตารางบนจอเท่านั้น (ไม่ใส่ในภาพ)

ปุ่ม `บันทึกเป็น PNG`:
- ระหว่างทำงานแสดง `กำลังสร้างภาพ…` และ disable ปุ่ม
- เสร็จแล้วเปิด dialog พรีวิว `<img>` (object URL) พร้อมข้อความ `แตะค้างที่ภาพเพื่อบันทึกลงรูปภาพ`
  - ปุ่ม `ดาวน์โหลด` เรียก `downloads.save({filename:"term2-2569.png", data: blob})` และซ่อนปุ่มเมื่อ `use("downloads")` เป็น null
  - ถ้า reject ด้วย `declined` ให้เงียบ ถ้าเป็น code อื่นให้แสดง `บันทึกไฟล์ไม่สำเร็จ`

- [ ] **Step 1: เขียน test ที่ fail**
  - `summary shows every class` (นับแถวได้ 26)
  - `png export is 3200px wide`
    - อ่าน blob ใน page แล้วใช้ `createImageBitmap` ได้ `width === 3200`
    - ความสูงต้องมากกว่า 0
  - `png export with 12 topics stays 3200px wide` (ตั้งให้ c01 มี 12 เรื่องก่อนส่งออก)
  - `download calls downloads.save` (`__mock.saved[0].filename === "term2-2569.png"`)
  - `review banner counts 21`
- [ ] **Step 2: รันแล้วต้อง FAIL**
- [ ] **Step 3: เขียน summary, `exportPng` และ dialog พรีวิว**
- [ ] **Step 4: รัน `npm test` แล้วต้อง PASS ทั้งหมด**
  - บันทึก PNG ตัวอย่างลง scratchpad แล้วเปิดดูด้วย Read เพื่อตรวจว่าภาษาไทยไม่ซ้อนหรือถูกตัด
- [ ] **Step 5: Commit** `feat(term2-planner): summary table and PNG export`

### Task 8: Publish, seed และส่งมอบ

**Files:** ไม่มี (ใช้เครื่องมือ)

- [ ] **Step 1: ตรวจก่อน publish**
  - รัน `npm test` ต้อง PASS
  - อ่าน Pre-Delivery Checklist ใน `ui-ux-pro-max/references/pro-rules.md` แล้วตรวจให้ครบ ได้แก่ focus ring, contrast, reduced-motion และ 375/768/1024px
- [ ] **Step 2: Publish ด้วย Artifact**
  - `file_path: term2-planner/index.html`
  - `files: {"app.js": …, "logic.js": …}`
  - `capabilities: {db: {}, downloads: true}`, `icon: "calendar"`
  - description: `กำหนดเนื้อหาคณิตเทอม 2 รายห้อง และส่งออกภาพสรุปรายครู`
- [ ] **Step 3: Seed**
  - รัน `node term2-planner/tools/seed-batch.mjs` แล้วส่ง ops เข้า `ArtifactData` action `batch` ด้วย url ของ artifact
  - ตรวจด้วย ArtifactData `list` ว่า `classes` ได้ 26 ห้อง, `topics` ได้ 24 เรื่อง และมี `meta/config`
- [ ] **Step 4: Push branch** `git push -u origin term2-planner`
- [ ] **Step 5: ส่งมอบลิงก์ให้ผู้ใช้**
  - บอกว่าต้องตรวจ 21 ห้องที่ติด ⚠ (ใช้ตัวกรอง "ต้องตรวจ")
  - บอกสิ่งที่ทดสอบแล้ว และสิ่งที่ทดสอบไม่ได้ (การบันทึกภาพบน iOS จริง)
