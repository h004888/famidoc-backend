# TÀI LIỆU HƯỚNG DẪN ĐỌC HIỂU TOÀN DIỆN MÃ NGUỒN - MAIN BUSINESS FLOW 2.3

> **Dự án:** Hệ thống Bác sĩ Gia đình FamiDoc (Backend API)  
> **Phân hệ nghiệp vụ:** Lập lịch Khám bệnh, Đàm phán Dời lịch & Cân bằng Tải Ca trực CSYT (Examination Scheduling, Rescheduling & Workload Balancing)  
> **Ngôn ngữ & Framework:** TypeScript, NestJS 12, Prisma ORM 6, PostgreSQL, JWT Authentication, Class-Validator, Jest.

---

## MỤC LỤC
1. [Tổng quan Kiến trúc & Sơ đồ Luồng Nghiệp vụ](#1-tổng-quan-kiến-trúc--sơ-đồ-luồng-nghiệp-vụ)
2. [Cơ sở Dữ liệu & Máy Trạng Thái (Database Models & State Machines)](#2-cơ-sở-dữ-liệu--máy-trạng-thái-database-models--state-machines)
3. [Bản đồ Cấu trúc Mã Nguồn (Source Code Architecture)](#3-bản-đồ-cấu-trúc-mã-nguồn-source-code-architecture)
4. [Giải thích Chi tiết Mã Nguồn Theo 5 Giai Đoạn (10 APIs)](#4-giải-thích-chi-tiết-mã-nguồn-theo-5-giai-đoạn-10-apis)
   - [Giai đoạn 1: Khởi tạo Lịch khám (Định kỳ & Đột xuất)](#giai-đoạn-1-khởi-tạo-lịch-khám-định-kỳ--đột-xuất)
   - [Giai đoạn 2: Bác sĩ Thẩm định & Chốt phương án khám](#giai-đoạn-2-bác-sĩ-thẩm-định--chốt-phương-án-khám)
   - [Giai đoạn 3: Gia đình Duyệt & Đối soát Xung đột Ca trực CSYT](#giai-đoạn-3-gia-đình-duyệt--đối-soát-xung-đột-ca-trực-csyt)
   - [Giai đoạn 4: Vòng lặp Đàm phán Dời lịch & Quy tắc Chặn SLA 4 Giờ](#giai-đoạn-4-vòng-lặp-đàm-phán-dời-lịch--quy-tắc-chặn-sla-4-giờ)
   - [Giai đoạn 5: Quản lý Ca trực CSYT & Tự động Nhắc hẹn (T-24h và T-2h)](#giai-đoạn-5-quản-lý-ca-trực-csyt--tự-động-nhắc-hẹn-t-24h-và-t-2h)
5. [Các Cơ Chế Kỹ Thuật Nền Tảng (Core Technical Highlights)](#5-các-cơ-chế-kỹ-thuật-nền-tảng-core-technical-highlights)
6. [Ma trận Kiểm thử Tự động (Unit Testing: 5 Happy Cases & 10 Unhappy Cases)](#6-ma-trận-kiểm-thử-tự-động-unit-testing-5-happy-cases--10-unhappy-cases)

---

## 1. TỔNG QUAN KIẾN TRÚC & SƠ ĐỒ LUỒNG NGHIỆP VỤ

### 1.1. Bản chất Nghiệp vụ của Main Flow 2.3
Main Business Flow 2.3 thiết lập cơ chế phối hợp 4 bên chặt chẽ:
* **Doctor (Bác sĩ phụ trách):** Chủ động xây dựng lộ trình khám định kỳ căn cứ theo quyền lợi gói y tế (`periodicVisitsQuota`) và tiền sử bệnh gia đình; thẩm định yêu cầu khám đột xuất; phản hồi đàm phán dời lịch.
* **Family Representative (Đại diện Hộ gia đình):** Khởi tạo yêu cầu khám đột xuất; xem xét lịch hẹn do bác sĩ đề xuất; xác nhận đồng ý hoặc yêu cầu đổi lịch với khung giờ mong muốn.
* **Platform System (Hệ thống FamiDoc Backend):** Thực thi các quy tắc nghiệp vụ khắt khe:
  1. *Quy tắc chặn 4 giờ (SLA Cut-off Rule):* Tự động từ chối yêu cầu đổi lịch nếu thời gian còn lại trước giờ khám $< 4$ giờ và hướng dẫn liên hệ Hotline.
  2. *Thuật toán kiểm tra xung đột (Shift Conflict Detection):* Đối chiếu khung giờ khám với ca trực nội viện của bác sĩ tại CSYT (`doctor_shifts`) và các lịch khám khác để chống trùng lặp (double-booking).
  3. *Đồng bộ lịch 3 bên (Tripartite Sync):* Cập nhật thời khóa biểu của Bác sĩ, Gia đình và Cơ sở Y tế.
  4. *Lập lịch nhắc hẹn tự động:* Tự động phát cảnh báo nhắc trước **24 giờ** và **2 giờ** (In-app Notification & Email).
* **Healthcare Facility (Cơ sở Y tế - CSYT):** Quản lý bảng phân ca trực nội viện của bác sĩ, theo dõi bảng điều phối ca trực kết hợp lịch khám ngoại viện/từ xa để cân bằng tải lao động.

---

### 1.2. Sơ đồ Tuần tự Nghiệp vụ Tổng thể (End-to-End Sequence Diagram)

```mermaid
sequenceDiagram
    autonumber
    actor Fam as Đại diện Gia đình
    actor Doc as Bác sĩ phụ trách
    participant API as FamiDoc Backend API
    participant DB as PostgreSQL (Prisma ORM)
    actor Fac as Cơ sở Y tế (CSYT)

    Note over Fam, Fac: GIAI ĐOẠN 1 & 2: KHỞI TẠO & CHỐT PHƯƠNG ÁN KHÁM
    alt Khám Định kỳ (Periodic Routine)
        Doc->>API: POST /api/v1/encounters/periodic (contractId, patientId, encounterType, date, time)
        API->>DB: Kiểm tra hạn ngạch gói, tạo Encounter (REQUESTED)
        API-->>Fam: Bắn thông báo đề xuất lịch khám định kỳ
    else Khám Đột xuất (Ad-hoc On-demand)
        Fam->>API: POST /api/v1/encounters/ad-hoc (contractId, patientId, desiredDate, desiredTime, reason)
        API->>DB: Tạo Encounter (REQUESTED, AD_HOC)
        API-->>Doc: Chuyển tiếp yêu cầu khám đột xuất cho Bác sĩ
        Doc->>API: PATCH /api/v1/encounters/:id/finalize (encounterType, scheduledDate, scheduledTime)
        API->>DB: Cập nhật lịch chốt
        API-->>Fam: Bắn thông báo lịch khám đã chốt gửi gia đình duyệt
    end

    Note over Fam, Fac: GIAI ĐOẠN 3 & 4: DUYỆT HOẶC ĐÀM PHÁN DỜI LỊCH
    alt Gia đình Đồng ý lịch khám
        Fam->>API: PATCH /api/v1/encounters/:id/confirm (confirmed: true)
        API->>DB: Đối soát xung đột với DoctorShift & các lịch khám khác
        alt Có xung đột ca trực CSYT
            API->>DB: Đánh dấu conflictAlert = true, ghi nhận chi tiết
            API-->>Doc: Cảnh báo xung đột ca trực
            API-->>Fac: Cảnh báo điều phối xung đột ca trực tại CSYT
        else Không có xung đột (Hợp lệ)
            API->>DB: Trừ hạn ngạch gói, chuyển trạng thái CONFIRMED
            API-->>Fam: Thông báo xác nhận lịch thành công
            API-->>Doc: Thông báo đồng bộ lịch khám vào thời khóa biểu
            API-->>Fac: Cập nhật bảng điều phối lịch bác sĩ
        end
    else Gia đình Yêu cầu Dời lịch (Reschedule Request)
        Fam->>API: POST /api/v1/encounters/:id/reschedule (proposedDate, proposedTime, reason)
        alt Thời gian còn lại < 4 giờ
            API-->>Fam: 400 Bad Request: Tự động từ chối do không đủ 4h; Hướng dẫn gọi Hotline
        else Thời gian còn lại >= 4 giờ
            API->>DB: Cập nhật proposedDate/Time, tăng rescheduleCount, ghi nhận lý do
            API-->>Doc: Bắn thông báo yêu cầu đổi lịch từ gia đình
            alt Bác sĩ Đồng ý
                Doc->>API: PATCH /api/v1/encounters/:id/reschedule-review (accept: true)
                API->>DB: Kiểm tra xung đột ca trực -> Chuyển sang CONFIRMED
                API-->>Fam: Thông báo bác sĩ đã chấp thuận lịch mới
            else Bác sĩ Bận nhưng Đề xuất Khung giờ khác (Counter-offer)
                Doc->>API: PATCH /api/v1/encounters/:id/reschedule-review (accept: false, counterDate, counterTime)
                API->>DB: Cập nhật proposedDate/Time theo giờ bác sĩ, proposedBy = 'DOCTOR'
                API-->>Fam: Bắn thông báo đề xuất khung giờ mới (Vòng lặp xem xét)
            else Bác sĩ Từ chối và Không có Slot trống
                Doc->>API: PATCH /api/v1/encounters/:id/reschedule-review (accept: false)
                API-->>Fam: Thông báo không còn slot trống, yêu cầu chọn thời điểm khác
            end
        end
    end

    Note over Fam, Fac: GIAI ĐOẠN 5: TỰ ĐỘNG NHẮC HẸN 24H & 2H
    loop Chạy ngầm định kỳ mỗi 15 phút (EncounterRemindersService)
        API->>DB: Quét các Encounter (CONFIRMED) sắp diễn ra
        API-->>Fam: Gửi Notification & Email nhắc lịch trước 24 giờ / 2 giờ
        API-->>Doc: Gửi Notification & Email nhắc ca khám sắp bắt đầu
    end
```

---

## 2. CƠ SỞ DỮ LIỆU & MÁY TRẠNG THÁI (DATABASE MODELS & STATE MACHINES)

### 2.1. Cấu trúc Mô hình Thực thể Prisma
Trong `prisma/schema.prisma`, phân hệ Lịch hẹn và Ca trực được chuẩn hóa:

```prisma
enum EncounterType {
  HOME_VISIT       // Khám tại nhà
  TELEHEALTH       // Tư vấn từ xa qua video call
  FACILITY_VISIT   // Khám trực tiếp tại Cơ sở Y tế
}

enum EncounterCategory {
  PERIODIC_ROUTINE  // Khám định kỳ theo lộ trình gói y tế
  AD_HOC_ON_DEMAND  // Khám đột xuất / phát sinh theo nhu cầu
}

enum EncounterStatus {
  REQUESTED         // Đang đề xuất / Chờ duyệt hoặc đàm phán
  CONFIRMED         // Đã xác nhận chính thức & đồng bộ lịch 3 bên
  IN_PROGRESS       // Đang trong buổi khám
  COMPLETED         // Đã khám xong & ghi bệnh án EMR
  CANCELLED         // Đã hủy buổi khám
}

model Encounter {
  id               String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  contractId       String            @map("contract_id") @db.Uuid
  patientId        String            @map("patient_id") @db.Uuid
  doctorId         String            @map("doctor_id") @db.Uuid
  encounterType    EncounterType     @map("encounter_type")
  category         EncounterCategory
  scheduledDate    DateTime          @map("scheduled_date") @db.Date
  scheduledTime    DateTime          @map("scheduled_time") @db.Time
  rescheduleCount  Int               @default(0) @map("reschedule_count")
  proposedDate     DateTime?         @map("proposed_date") @db.Date
  proposedTime     DateTime?         @map("proposed_time") @db.Time
  proposedBy       String?           @map("proposed_by") @db.VarChar(50)
  rescheduleReason String?           @map("reschedule_reason") @db.Text
  conflictAlert    Boolean           @default(false) @map("conflict_alert")
  conflictDetails  String?           @map("conflict_details") @db.Text
  encounterStatus  EncounterStatus   @default(REQUESTED) @map("encounter_status")
  cancelReason     String?           @map("cancel_reason") @db.Text
  createdAt        DateTime          @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt        DateTime          @default(now()) @updatedAt @map("updated_at") @db.Timestamptz()

  // Quan hệ
  contract         MedicalContract   @relation(fields: [contractId], references: [id])
  patient          Patient           @relation(fields: [patientId], references: [id])
  doctor           Doctor            @relation(fields: [doctorId], references: [id])
}

model DoctorShift {
  id         String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  doctorId   String             @map("doctor_id") @db.Uuid
  facilityId String             @map("facility_id") @db.Uuid
  shiftDate  DateTime           @map("shift_date") @db.Date
  startTime  DateTime           @map("start_time") @db.Time
  endTime    DateTime           @map("end_time") @db.Time
  shiftType  String             @map("shift_type") @db.VarChar(50)
  notes      String?            @db.Text

  doctor     Doctor             @relation(fields: [doctorId], references: [id])
  facility   HealthcareFacility @relation(fields: [facilityId], references: [id])
}
```

---

## 3. BẢN ĐỒ CẤU TRÚC MÃ NGUỒN (SOURCE CODE ARCHITECTURE)

```
src/modules/encounters/
├── controllers/
│   └── encounters.controller.ts             # REST API Controller điều phối luồng 4 bên
├── dtos/
│   ├── create-periodic-encounter.dto.ts     # DTO Bác sĩ lập lộ trình khám định kỳ
│   ├── create-adhoc-encounter.dto.ts        # DTO Gia đình yêu cầu khám đột xuất
│   ├── finalize-encounter.dto.ts            # DTO Bác sĩ chốt hình thức & thời gian khám
│   ├── confirm-encounter.dto.ts             # DTO Gia đình xác nhận lịch khám
│   ├── request-reschedule.dto.ts            # DTO Đề xuất đổi lịch (Quy tắc 4 giờ)
│   ├── doctor-reschedule-review.dto.ts      # DTO Bác sĩ phản hồi (Đồng ý/Counter-offer)
│   ├── create-doctor-shift.dto.ts           # DTO CSYT tạo ca trực cho bác sĩ
│   ├── list-encounters-query.dto.ts         # DTO Phân trang & lọc thời khóa biểu
│   └── encounter-response.dto.ts
├── repositories/
│   ├── interfaces/
│   │   └── encounters.repository.interface.ts # Interface và Session Pattern
│   └── impl/
│       └── encounters.repository.impl.ts      # Triển khai Prisma Serializable Transaction
├── services/
│   ├── interfaces/
│   │   └── encounters.service.interface.ts    # Interface nghiệp vụ FamiDoc
│   └── impl/
│       ├── encounters.service.impl.ts         # Service nghiệp vụ & Thuật toán kiểm tra xung đột
│       └── encounter-reminders.service.ts     # Scheduler chạy ngầm nhắc hẹn 24h & 2h
├── __tests__/
│   ├── encounters.service.spec.ts           # Unit tests bao phủ 15 kịch bản Happy & Unhappy
│   ├── encounters.controller.spec.ts        # Unit tests tầng Controller & Role Guard
│   └── encounter-reminders.service.spec.ts  # Unit tests Scheduler nhắc hẹn tự động
└── encounters.module.ts                     # NestJS Module đăng ký vào AppModule
```

---

## 4. GIẢI THÍCH CHI TIẾT MÃ NGUỒN THEO 5 GIAI ĐOẠN (10 APIs)

### Giai đoạn 1: Khởi tạo Lịch khám (Định kỳ & Đột xuất)
1. `POST /api/v1/encounters/periodic`: Bác sĩ phụ trách lập lịch khám định kỳ dựa trên gói dịch vụ và tiền sử bệnh.
   * *Ràng buộc:* Người gọi phải mang role `DOCTOR` hoặc `ADMIN`. Hợp đồng y tế phải ở trạng thái `ACTIVE`. Bệnh nhân phải là thành viên hợp lệ (`ContractMember`). Hạn ngạch khám tương ứng (`remainingHomeVisits` hoặc `remainingTelehealth`) phải $> 0$.
2. `POST /api/v1/encounters/ad-hoc`: Đại diện hộ gia đình tạo yêu cầu khám đột xuất.
   * *Ràng buộc:* Người gọi phải là `FAMILY_REP` đại diện cho hợp đồng (`contract.familyUnit.representativeUserId === actor.id`).

### Giai đoạn 2: Bác sĩ Thẩm định & Chốt phương án khám
3. `PATCH /api/v1/encounters/:id/finalize`: Bác sĩ phụ trách xem xét yêu cầu, điều chỉnh ngày giờ hoặc lựa chọn hình thức khám phù hợp (`HOME_VISIT`, `TELEHEALTH`, `FACILITY_VISIT`).
   * *Hành vi:* Lưu lịch đề xuất và tự động bắn thông báo cho gia đình để xem xét.

### Giai đoạn 3: Gia đình Duyệt & Đối soát Xung đột Ca trực CSYT
4. `PATCH /api/v1/encounters/:id/confirm`: Gia đình bấm đồng ý với lịch khám đề xuất.
   * *Thuật toán kiểm tra xung đột:* Hệ thống đối chiếu thời gian khám (mặc định 45 phút) với:
     - Toàn bộ ca trực của bác sĩ tại CSYT trong bảng `doctor_shifts`.
     - Toàn bộ các lịch khám đã `CONFIRMED` khác của bác sĩ trong cùng ngày.
   * *Nếu có xung đột:* Không trừ hạn ngạch, bật cờ `conflictAlert = true`, lưu lý do vào `conflictDetails`, và bắn cảnh báo khẩn cấp tới Bác sĩ và Cơ sở Y tế.
   * *Nếu không xung đột:* Chuyển trạng thái sang `CONFIRMED`, trừ 1 lượt trong hạn ngạch hợp đồng, và đồng bộ thông báo tới cả 3 bên (Bác sĩ, Gia đình, CSYT).

### Giai đoạn 4: Vòng lặp Đàm phán Dời lịch & Quy tắc Chặn SLA 4 Giờ
5. `POST /api/v1/encounters/:id/reschedule`: Gia đình đề xuất đổi ngày/giờ khám thay thế.
   * *Quy tắc chặn 4 giờ:* Hệ thống tính khoảng cách giữa thời điểm hiện tại và giờ khám `(scheduledDateTime - now)`.
     - Nếu $< 4$ giờ: Ném ngoại lệ `BadRequestException`, tự động từ chối yêu cầu và thông báo gia đình liên hệ Hotline hỗ trợ.
     - Nếu $\ge 4$ giờ: Tăng `rescheduleCount` lên 1 (chặn nếu $\ge 3$ lần), lưu khung giờ đề xuất `proposedDate`/`proposedTime`, và gửi thông báo cho bác sĩ.
6. `PATCH /api/v1/encounters/:id/reschedule-review`: Bác sĩ phản hồi đề xuất dời lịch.
   * *Trường hợp 1 (Đồng ý):* Bác sĩ chấp thuận $\rightarrow$ Kiểm tra lại xung đột ca trực $\rightarrow$ Đồng bộ sang `CONFIRMED` với giờ mới.
   * *Trường hợp 2 (Counter-offer):* Bác sĩ bận nhưng gửi lại khung giờ khác (`counterDate`, `counterTime`) $\rightarrow$ Cập nhật `proposedBy = 'DOCTOR'` và gửi lại cho gia đình xem xét (vòng lặp đàm phán).
   * *Trường hợp 3 (Không có slot):* Bác sĩ từ chối và báo không có khung giờ phù hợp $\rightarrow$ Thông báo gia đình chọn mốc thời gian khác.

### Giai đoạn 5: Quản lý Ca trực CSYT & Tự động Nhắc hẹn (T-24h và T-2h)
7. `POST /api/v1/encounters/shifts`: CSYT phân bổ ca trực nội viện cho bác sĩ (`startTime` phải trước `endTime`).
8. `GET /api/v1/encounters/timetable/doctor`: Lấy thời khóa biểu khám của Bác sĩ.
9. `GET /api/v1/encounters/timetable/family`: Lấy thời khóa biểu khám của Hộ gia đình.
10. `GET /api/v1/encounters/facility/schedule-board`: CSYT tra cứu bảng điều phối ca trực và lịch khám ngoại viện.
11. `EncounterRemindersService`: Background job chạy ngầm định kỳ mỗi 15 phút, quét các lịch hẹn `CONFIRMED`:
    * Khung giờ **23h - 25h**: Bắn thông báo `ENCOUNTER_REMINDER_24H` cho Gia đình và Bác sĩ.
    * Khung giờ **1h45m - 2h15m**: Bắn thông báo `ENCOUNTER_REMINDER_2H` cho Gia đình và Bác sĩ.
    * Sử dụng mã tham chiếu duy nhất (ví dụ: `enc-id_24H_FAM`) kết hợp `skipDuplicates: true` để chống gửi lặp.

---

## 5. CÁC CƠ CHẾ KỸ THUẬT NỀN TẢNG (CORE TECHNICAL HIGHLIGHTS)

1. **Thuật toán Kiểm tra Giao khoảng Thời gian (Time Interval Overlap):**
   Hai khoảng thời gian $[A_{start}, A_{end}]$ và $[B_{start}, B_{end}]$ giao nhau khi và chỉ khi:
   $$\max(A_{start}, B_{start}) < \min(A_{end}, B_{end}) \iff A_{start} < B_{end} \land A_{end} > B_{start}$$
   Hàm `getTimeWindowMinutes()` chuẩn hóa thời gian thành số phút tính từ 00:00 (ví dụ 09:30 $\rightarrow$ 570 phút) giúp việc so sánh độc lập hoàn toàn với định dạng múi giờ.
2. **Kiểm soát Toàn vẹn Giao dịch (Serializable Transaction):**
   Mọi thao tác thay đổi trạng thái và trừ hạn ngạch (`decrementContractQuota`) được bọc trong giao dịch tuần tự hóa `serializable()`, đảm bảo không thể xảy ra hiện tượng thất thoát hạn ngạch hoặc đặt lịch trùng khi có yêu cầu đồng thời (race condition).
3. **Idempotent Scheduler Reminders:**
   Nhờ cơ chế tạo mã tham chiếu phân biệt theo loại nhắc và đối tượng nhận (`referenceId: ${enc.id}_24H_FAM`), dù scheduler có chạy nhiều lần trong cùng một khung giờ, hệ thống vẫn không bao giờ bắn thông báo trùng lặp cho người dùng.

---

## 6. MA TRẬN KIỂM THỬ TỰ ĐỘNG (UNIT TESTING: 5 HAPPY CASES & 10 UNHAPPY CASES)

Toàn bộ **34 Unit Tests** đã được viết và chạy thành công 100% trong `src/modules/encounters/__tests__/`:

| Mã Case | Loại | Tên Kịch bản Kiểm thử | Trạng thái Test |
| :--- | :--- | :--- | :---: |
| **TC-H01** | Happy | Bác sĩ lập lịch định kỳ $\rightarrow$ Gia đình duyệt $\rightarrow$ Không xung đột ca trực $\rightarrow$ `CONFIRMED` & trừ hạn ngạch | **PASSED** |
| **TC-H02** | Happy | Gia đình yêu cầu khám đột xuất (`AD_HOC_ON_DEMAND`) thành công | **PASSED** |
| **TC-H03** | Happy | Gia đình xin dời lịch trước $\ge 4$ giờ $\rightarrow$ Bác sĩ chấp thuận $\rightarrow$ Đồng bộ lịch mới | **PASSED** |
| **TC-H04** | Happy | Bác sĩ bận, phản hồi đề xuất khung giờ thay thế (Counter-offer) thành công | **PASSED** |
| **TC-H05** | Happy | Tự động quét và gửi nhắc hẹn trước 24h và 2h không trùng lặp | **PASSED** |
| **TC-U01** | Unhappy | Xin dời lịch khi còn dưới 4 giờ $\rightarrow$ Tự động từ chối & báo gọi Hotline | **PASSED** |
| **TC-U02** | Unhappy | Bác sĩ từ chối dời lịch và không có khung giờ trống phù hợp | **PASSED** |
| **TC-U03** | Unhappy | Trùng ca trực nội viện CSYT $\rightarrow$ Bật cờ `conflictAlert` & bắn cảnh báo | **PASSED** |
| **TC-U04** | Unhappy | Trùng lịch khám đã xác nhận khác của bác sĩ (Double booking) $\rightarrow$ Cảnh báo | **PASSED** |
| **TC-U05** | Unhappy | Hạn ngạch khám tại nhà/từ xa đã hết $\rightarrow$ Chặn tạo lịch định kỳ (400 Bad Request) | **PASSED** |
| **TC-U06** | Unhappy | Hợp đồng không ở trạng thái ACTIVE $\rightarrow$ Chặn tạo lịch | **PASSED** |
| **TC-U07** | Unhappy | Bệnh nhân không thuộc hợp đồng $\rightarrow$ Chặn tạo lịch | **PASSED** |
| **TC-U08** | Unhappy | Dời lịch vượt quá giới hạn tối đa 3 lần $\rightarrow$ Chặn dời lịch | **PASSED** |
| **TC-U09** | Unhappy | Ca trực CSYT có giờ bắt đầu sau giờ kết thúc $\rightarrow$ Chặn tạo ca trực | **PASSED** |
| **TC-U10** | Unhappy | Người dùng gọi API không đúng quyền (Role Guard) $\rightarrow$ 403 Forbidden | **PASSED** |
