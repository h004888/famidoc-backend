import xml.etree.ElementTree as ET
import os

def escape_xml_attr(val: str) -> str:
    # First escape ampersands, then <, >, ", '
    val = val.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;")
    # Now replace newlines with &#xa;
    val = val.replace("\n", "&#xa;")
    return val

entities = [
    # 1. PHÂN HỆ XÁC THỰC, NGƯỜI DÙNG & RBAC
    {
        "id": "user",
        "name": "User",
        "attrs": [
            "+ Full Name",
            "+ Email Address",
            "+ Phone Number",
            "+ System Role",
            "+ Account Status",
            "+ Failed Login Counter"
        ],
        "x": 40, "y": 40
    },
    {
        "id": "notification",
        "name": "Notification",
        "attrs": [
            "+ Message Title",
            "+ Message Content",
            "+ Notification Type",
            "+ Read Status",
            "+ Sent Timestamp"
        ],
        "x": 40, "y": 240
    },
    {
        "id": "audit_log",
        "name": "AuditLog",
        "attrs": [
            "+ Performed Action",
            "+ Target Resource",
            "+ Target Resource ID",
            "+ Client IP Address",
            "+ User Agent Header",
            "+ Action Timestamp"
        ],
        "x": 40, "y": 440
    },
    {
        "id": "system_config",
        "name": "SystemConfiguration",
        "attrs": [
            "+ Config Parameter Key",
            "+ Config Parameter Value",
            "+ Parameter Description",
            "+ Last Modified Time"
        ],
        "x": 40, "y": 640
    },

    # 2. PHÂN HỆ CƠ SỞ Y TẾ & BÁC SĨ GIA ĐÌNH
    {
        "id": "facility",
        "name": "HealthcareFacility",
        "attrs": [
            "+ Facility Name",
            "+ Medical License Number",
            "+ Enterprise Tax Code",
            "+ Physical Address",
            "+ Operating Hotline",
            "+ Banking Details",
            "+ Verification Status"
        ],
        "x": 280, "y": 40
    },
    {
        "id": "doctor",
        "name": "Doctor",
        "attrs": [
            "+ Doctor Full Name",
            "+ Medical Specialty",
            "+ Academic Title",
            "+ Years of Experience",
            "+ Patient Panel Capacity",
            "+ Average Rating Score",
            "+ Onboarding Status"
        ],
        "x": 520, "y": 40
    },
    {
        "id": "doctor_credential",
        "name": "DoctorCredential",
        "attrs": [
            "+ Credential Classification",
            "+ Certificate License Number",
            "+ Issuing Authority",
            "+ Certificate Issue Date",
            "+ Facility Verification Flag",
            "+ Platform Approval Flag"
        ],
        "x": 760, "y": 40
    },
    {
        "id": "doctor_shift",
        "name": "DoctorShift",
        "attrs": [
            "+ Shift Scheduled Date",
            "+ Shift Start Time",
            "+ Shift End Time",
            "+ Shift Work Type",
            "+ Duty Roster Notes"
        ],
        "x": 520, "y": 240
    },
    {
        "id": "b2b_contract",
        "name": "B2bStaffingContract",
        "attrs": [
            "+ Staffing Contract Code",
            "+ Platform Commission Rate",
            "+ Facility Revenue Rate",
            "+ Valid Contract Term",
            "+ Legal Contract Status"
        ],
        "x": 280, "y": 240
    },

    # 3. PHÂN HỆ GÓI DỊCH VỤ & HỢP ĐỒNG PHÁP LÝ
    {
        "id": "service_package",
        "name": "ServicePackage",
        "attrs": [
            "+ Service Package Code",
            "+ Service Package Name",
            "+ Package Validity Months",
            "+ Base Package Price",
            "+ Periodic Visits Quota",
            "+ Telehealth Visits Quota",
            "+ Included Member Count",
            "+ Package Lifecycle Status"
        ],
        "x": 280, "y": 460
    },
    {
        "id": "medical_contract",
        "name": "MedicalContract",
        "attrs": [
            "+ Formal Contract Number",
            "+ Effective Coverage Period",
            "+ Total Contract Value",
            "+ Remaining Home Visits",
            "+ Remaining Telehealth Visits",
            "+ Registered Member Count",
            "+ Medical Contract Status"
        ],
        "x": 520, "y": 460
    },
    {
        "id": "contract_signature",
        "name": "ContractSignature",
        "attrs": [
            "+ Signer Legal Role",
            "+ Digital Signature Hash",
            "+ Terms and Conditions Hash",
            "+ Signed Date Timestamp",
            "+ Signer IP Address"
        ],
        "x": 760, "y": 460
    },
    {
        "id": "contract_addendum",
        "name": "ContractAddendum",
        "attrs": [
            "+ Addendum Identifier Number",
            "+ Addendum Extension Type",
            "+ Additional Surcharge Fee",
            "+ Additional Home Visits",
            "+ Additional Telehealth Visits",
            "+ Extended Expiration Date",
            "+ Addendum Legal Status"
        ],
        "x": 760, "y": 660
    },

    # 4. PHÂN HỆ HỘ GIA ĐÌNH & HỒ SƠ BỆNH ÁN DỌC
    {
        "id": "family_unit",
        "name": "FamilyUnit",
        "attrs": [
            "+ Household Residence Address",
            "+ Emergency Contact Hotline",
            "+ Family Unit Profile Status",
            "+ Profile Registration Date"
        ],
        "x": 280, "y": 800
    },
    {
        "id": "patient",
        "name": "Patient",
        "attrs": [
            "+ Member Full Name",
            "+ Patient Date of Birth",
            "+ Biological Gender",
            "+ Relationship to Household Head",
            "+ Citizen Identity Card",
            "+ Health Insurance Card Number",
            "+ Active Patient Status"
        ],
        "x": 520, "y": 800
    },
    {
        "id": "patient_allergy",
        "name": "PatientAllergy",
        "attrs": [
            "+ Allergen Category",
            "+ Allergen Substance Name",
            "+ Hazard Severity Degree",
            "+ Clinical Manifestation Symptom"
        ],
        "x": 760, "y": 800
    },
    {
        "id": "patient_document",
        "name": "PatientDocument",
        "attrs": [
            "+ Medical Record Title",
            "+ Document Category Type",
            "+ Clinical Examination Date",
            "+ Storage File Size Info"
        ],
        "x": 760, "y": 960
    },

    # 5. PHÂN HỆ ĐIỀU PHỐI LỊCH HẸN, TELEHEALTH & BỆNH ÁN SOAP
    {
        "id": "encounter",
        "name": "Encounter",
        "attrs": [
            "+ Clinical Care Modality",
            "+ Scheduled Visit Category",
            "+ Planned Appointment Date",
            "+ Planned Appointment Time",
            "+ Reschedule Attempt Counter",
            "+ Current Encounter Status",
            "+ Appointment Cancellation Reason"
        ],
        "x": 520, "y": 1040
    },
    {
        "id": "telehealth_session",
        "name": "TelehealthSession",
        "attrs": [
            "+ Telehealth Room ID",
            "+ Call Start and End Time",
            "+ Total Call Duration Seconds",
            "+ Network Connection Quality",
            "+ Fallback Text Chat Active"
        ],
        "x": 280, "y": 1040
    },
    {
        "id": "clinical_emr",
        "name": "ClinicalEmr",
        "attrs": [
            "+ Primary Chief Complaint",
            "+ Anamnesis Disease History",
            "+ Objective Clinical Findings",
            "+ ICD-10 Diagnostic Classification",
            "+ Prescribed Medical Treatment Plan",
            "+ Record Finalized Status"
        ],
        "x": 520, "y": 1280
    },
    {
        "id": "vital_sign",
        "name": "VitalSign",
        "attrs": [
            "+ Systolic and Diastolic Pressure",
            "+ Heart Pulse Rate",
            "+ Core Body Temperature",
            "+ Blood Oxygen Level SpO2",
            "+ Blood Glucose Concentration",
            "+ Abnormal Warning Indicator"
        ],
        "x": 280, "y": 1280
    },
    {
        "id": "prescription",
        "name": "Prescription",
        "attrs": [
            "+ Prescription Serial Code",
            "+ Prescribed Issuance Date",
            "+ Valid Dispensation End Date",
            "+ Medication Usage Instructions",
            "+ Doctor Digital Signature Hash",
            "+ Prescription Fulfillment Status"
        ],
        "x": 760, "y": 1280
    },
    {
        "id": "prescription_detail",
        "name": "PrescriptionDetail",
        "attrs": [
            "+ Pharmaceutical Drug Name",
            "+ Standard Clinical Dosage",
            "+ Dispensed Quantity and Unit",
            "+ Daily Administration Frequency",
            "+ Regimen Duration Days"
        ],
        "x": 1000, "y": 1280
    },
    {
        "id": "referral_order",
        "name": "ReferralOrder",
        "attrs": [
            "+ Official Referral Code",
            "+ Receiving Hospital Facility",
            "+ Clinical Reason for Transfer",
            "+ Medical Case Summary",
            "+ Patient Transport Mode"
        ],
        "x": 520, "y": 1500
    },

    # 6. PHÂN HỆ TÀI CHÍNH, THANH TOÁN & QUYẾT TOÁN B2B
    {
        "id": "invoice",
        "name": "Invoice",
        "attrs": [
            "+ Official Invoice Code",
            "+ Dynamic Payment Transfer Memo",
            "+ Pre-tax Gross Amount",
            "+ Applicable Value Added Tax",
            "+ Final Payable Net Amount",
            "+ Payment Gateway Channel",
            "+ Invoice Settlement Status"
        ],
        "x": 1000, "y": 660
    },
    {
        "id": "payment_transaction",
        "name": "PaymentTransaction",
        "attrs": [
            "+ Gateway Transaction Reference",
            "+ Intermediary Gateway Provider",
            "+ Destination Bank Account Number",
            "+ Total Received Monetary Amount",
            "+ Webhook Digital Signature Verified",
            "+ Reconciliation Process Status"
        ],
        "x": 1240, "y": 660
    },
    {
        "id": "facility_settlement",
        "name": "FacilitySettlement",
        "attrs": [
            "+ Settlement Batch Code",
            "+ Settlement Billing Month and Year",
            "+ Total Realized Facility Revenue",
            "+ Platform Service Fee Retained",
            "+ Net Facility Payout Amount",
            "+ Bank Disbursement Batch Status",
            "+ Payout Bank Transfer Evidence"
        ],
        "x": 1000, "y": 380
    },
    {
        "id": "facility_settlement_item",
        "name": "FacilitySettlementItem",
        "attrs": [
            "+ Itemized Invoice Gross Amount",
            "+ Itemized Value Added Tax",
            "+ Itemized Realized Net Revenue",
            "+ Platform Commission Amount",
            "+ Facility Earned Share Amount"
        ],
        "x": 1000, "y": 180
    },

    # 7. PHÂN HỆ ĐÁNH GIÁ & KHIẾU NẠI PHI TÀI CHÍNH
    {
        "id": "doctor_review",
        "name": "DoctorReview",
        "attrs": [
            "+ Star Rating Assessment (1 to 5)",
            "+ Patient Subjective Feedback",
            "+ Review Submission Date Time"
        ],
        "x": 1000, "y": 880
    },
    {
        "id": "complaint",
        "name": "Complaint",
        "attrs": [
            "+ Complaint Ticket Number",
            "+ Dispute Classification Category",
            "+ Grievance Narrative Description",
            "+ Facility Clarification Response",
            "+ Final Resolution Ruling",
            "+ Grievance Closure Notes",
            "+ Investigation Workflow Status"
        ],
        "x": 1000, "y": 1060
    }
]

relationships = [
    # IAM & Relations
    {"from": "user", "to": "notification", "label": "receiving\n(User)", "card": "0..*"},
    {"from": "user", "to": "facility", "label": "managing\n(Facility Admin)", "card": "0..1"},
    {"from": "user", "to": "doctor", "label": "practicing as\n(Doctor)", "card": "0..1"},
    {"from": "user", "to": "family_unit", "label": "representing\n(Family Rep)", "card": "0..1"},
    {"from": "user", "to": "contract_signature", "label": "signing digitally\n(Signer)", "card": "0..*"},
    {"from": "user", "to": "complaint", "label": "filing grievance\n(Complainant)", "card": "0..*"},
    {"from": "user", "to": "audit_log", "label": "logging activity\n(Security Audit)", "card": "0..*"},
    {"from": "user", "to": "system_config", "label": "configuring\n(System Admin)", "card": "0..*"},

    # Facility & Doctor
    {"from": "facility", "to": "doctor", "label": "employing\n(Healthcare Facility)", "card": "1..*"},
    {"from": "facility", "to": "doctor_shift", "label": "scheduling roster\n(Facility Admin)", "card": "0..*"},
    {"from": "facility", "to": "b2b_contract", "label": "contracting B2B\n(Healthcare Facility)", "card": "1..*"},
    {"from": "facility", "to": "medical_contract", "label": "fulfilling care\n(Healthcare Facility)", "card": "0..*"},
    {"from": "facility", "to": "facility_settlement", "label": "settling revenue\n(Healthcare Facility)", "card": "0..*"},

    {"from": "doctor", "to": "doctor_credential", "label": "holding certified\n(Doctor)", "card": "1..*"},
    {"from": "doctor", "to": "doctor_shift", "label": "assigned duty\n(Doctor)", "card": "0..*"},
    {"from": "doctor", "to": "medical_contract", "label": "designated doctor\n(Doctor)", "card": "0..*"},
    {"from": "doctor", "to": "encounter", "label": "conducting visit\n(Doctor)", "card": "0..*"},
    {"from": "doctor", "to": "doctor_review", "label": "evaluated in\n(Doctor)", "card": "0..*"},

    # Packages & Contracts
    {"from": "service_package", "to": "medical_contract", "label": "defining package terms\n(Platform Admin)", "card": "0..*"},

    # Family & Patients
    {"from": "family_unit", "to": "patient", "label": "registering members\n(Family Rep)", "card": "1..*"},
    {"from": "family_unit", "to": "medical_contract", "label": "purchasing plan\n(Family Rep)", "card": "0..*"},
    {"from": "family_unit", "to": "doctor_review", "label": "submitting review\n(Family Rep)", "card": "0..*"},

    {"from": "patient", "to": "patient_allergy", "label": "diagnosed allergy\n(Patient)", "card": "0..*"},
    {"from": "patient", "to": "patient_document", "label": "owning health records\n(Patient)", "card": "0..*"},
    {"from": "patient", "to": "encounter", "label": "attending examination\n(Patient)", "card": "0..*"},
    {"from": "patient", "to": "vital_sign", "label": "measuring vitals\n(Patient)", "card": "0..*"},

    # Contracts & Addenda & Signatures
    {"from": "medical_contract", "to": "contract_signature", "label": "authenticated with signatures\n(4 Contract Signers)", "card": "1..*"},
    {"from": "medical_contract", "to": "contract_addendum", "label": "supplementing clauses\n(Contract Parties)", "card": "0..*"},
    {"from": "medical_contract", "to": "encounter", "label": "authorizing visits\n(Contract Quota)", "card": "0..*"},
    {"from": "medical_contract", "to": "invoice", "label": "invoicing contract fee\n(Billing System)", "card": "0..*"},
    {"from": "medical_contract", "to": "complaint", "label": "subject to dispute\n(Dispute Resolution)", "card": "0..*"},

    {"from": "contract_addendum", "to": "contract_signature", "label": "endorsing addendum\n(Signers)", "card": "0..*"},
    {"from": "contract_addendum", "to": "invoice", "label": "invoicing addendum fee\n(Billing System)", "card": "0..*"},

    # Encounters & Clinical EMR
    {"from": "encounter", "to": "telehealth_session", "label": "hosting video consultation\n(Telehealth Engine)", "card": "0..1"},
    {"from": "encounter", "to": "clinical_emr", "label": "documenting SOAP chart\n(Doctor)", "card": "0..1"},
    {"from": "encounter", "to": "invoice", "label": "billing copay fee\n(Billing System)", "card": "0..*"},
    {"from": "encounter", "to": "doctor_review", "label": "feedback generated\n(Family Rep)", "card": "0..1"},
    {"from": "encounter", "to": "complaint", "label": "referenced incident\n(Complainant)", "card": "0..*"},

    {"from": "clinical_emr", "to": "vital_sign", "label": "recording vital metrics\n(Doctor)", "card": "0..*"},
    {"from": "clinical_emr", "to": "prescription", "label": "prescribing medication\n(Doctor)", "card": "0..*"},
    {"from": "clinical_emr", "to": "referral_order", "label": "referring higher tier\n(Doctor)", "card": "0..1"},

    {"from": "prescription", "to": "prescription_detail", "label": "itemizing drugs\n(Doctor)", "card": "1..*"},

    # Invoices & Settlements
    {"from": "invoice", "to": "payment_transaction", "label": "reconciled with transaction\n(Payment Gateway)", "card": "0..*"},
    {"from": "invoice", "to": "facility_settlement_item", "label": "apportioned in settlement\n(Finance Accounting)", "card": "0..1"},
    {"from": "facility_settlement", "to": "facility_settlement_item", "label": "aggregating payout items\n(Finance Accounting)", "card": "1..*"}
]

card_to_arrow = {
    "0..*": "endArrow=ERzeroToMany;endFill=0;",
    "1..*": "endArrow=ERoneToMany;endFill=0;",
    "1": "endArrow=ERmandOne;",
    "0..1": "endArrow=ERzeroToOne;"
}

lines = []
lines.append('<mxGraphModel adaptiveColors="auto">')
lines.append('  <root>')
lines.append('    <mxCell id="0" />')
lines.append('    <mxCell id="1" parent="0" />')

for ent in entities:
    e_id = f"ent_{ent['id']}"
    num_attrs = len(ent["attrs"])
    height = 28 + (num_attrs * 18) + 16
    width = 160
    
    ent_style = (
        "swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=28;horizontalStack=0;"
        "resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;whiteSpace=wrap;"
        "html=1;rounded=1;arcSize=10;strokeWidth=2;strokeColor=#000000;fillColor=#ffffff;"
        "fontFamily=Helvetica;fontSize=13;"
    )
    lines.append(f'    <mxCell id="{e_id}" value="{ent["name"]}" style="{ent_style}" vertex="1" parent="1">')
    lines.append(f'      <mxGeometry x="{ent["x"]}" y="{ent["y"]}" width="{width}" height="{height}" as="geometry" />')
    lines.append('    </mxCell>')
    
    escaped_attrs = [escape_xml_attr(a) for a in ent["attrs"]]
    attrs_val = "&#xa;".join(escaped_attrs)
    attr_style = (
        "text;strokeColor=none;fillColor=none;align=left;verticalAlign=top;spacingLeft=8;spacingTop=6;"
        "overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;whiteSpace=wrap;"
        "html=1;fontFamily=Helvetica;fontSize=12;"
    )
    lines.append(f'    <mxCell id="{e_id}_attrs" value="{attrs_val}" style="{attr_style}" vertex="1" parent="{e_id}">')
    lines.append(f'      <mxGeometry y="28" width="{width}" height="{height - 28}" as="geometry" />')
    lines.append('    </mxCell>')

for idx, rel in enumerate(relationships):
    edge_id = f"edge_{idx}_{rel['from']}_{rel['to']}"
    src_id = f"ent_{rel['from']}"
    tgt_id = f"ent_{rel['to']}"
    arrow_style = card_to_arrow[rel["card"]]
    
    edge_style = (
        f"edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;"
        f"strokeColor=#000000;strokeWidth=1.5;startArrow=none;{arrow_style}"
        f"fontSize=11;align=center;verticalAlign=bottom;labelBackgroundColor=#ffffff;"
    )
    escaped_label = escape_xml_attr(rel["label"])
    
    lines.append(f'    <mxCell id="{edge_id}" value="{escaped_label}" style="{edge_style}" edge="1" parent="1" source="{src_id}" target="{tgt_id}">')
    lines.append('      <mxGeometry relative="1" as="geometry" />')
    lines.append('    </mxCell>')

lines.append('  </root>')
lines.append('</mxGraphModel>')

full_xml = "\n".join(lines)

# Validate XML parse
ET.fromstring(full_xml)
print("XML is 100% valid XML!")

output_path = r"c:\Users\ADMIN\Downloads\famidoc\famidoc-backend\famidoc_conceptual_erd.drawio"
with open(output_path, "w", encoding="utf-8") as f:
    f.write(full_xml)

print(f"Successfully saved to {output_path}")
