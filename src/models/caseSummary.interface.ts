export interface IAccountNumber {
  patientId?: number | null;
  organizationId?: number | null;
  accountNumber?: string | null;
  sourceIdentifier?: string | null;
  isPrimary?: boolean;
  alias?: string | null;
  sortOrder?: number;
  externalCaseRequestId?: string | null;
}

export interface IPhone {
  phoneId?: number;
  patientId?: number | null;
  phoneType?: string | null;
  primaryContactTf?: boolean;
  phoneNumber?: string | null;
  phoneExtension?: string | null;
  isCellPhoneTf?: boolean;
  adtMaintainedFieldArray?: any[] | null;
  sourceIdentifier?: string | null;
}

export interface IAddress {
  country?: string | null;
  line1?: string | null;
  line2?: string | null;
  zip?: string | null;
  state?: string | null;
  city?: string | null;
  county?: string | null;
}

export interface IPatient {
  patientId?: number;
  firstName?: string | null;
  lastName?: string | null;
  middleInitial?: string | null;
  title?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  primaryAccountNumber?: string | null;
  accountNumbers?: IAccountNumber[];
  mpiPatientPhone?: IPhone | null;
  mpiPatientPhoneSecondary?: IPhone | null;
  address?: IAddress | null;
  fullName?: string | null;
  fullNameWithTitle?: string | null;
  fullNameWithTitlePrefixAsLastName?: string | null;
  externalId?: number | string | null;
  sourceIdentifier?: string | null;
  [key: string]: any;
}

export interface ICaseGuarantorItem {
  sortOrder?: number;
  isActive?: boolean;
  patientGuarantor?: any;
  isSelf?: boolean;
  guarantorId?: number;
}

export interface ICaseProcedure {
  physicianId?: number;
  physician?: string;
  procedureDescription?: string;
  primaryProcedureTf?: boolean;
  procedureSequence?: number;
  feeScheduleId?: number;
  [key: string]: any;
}

export interface ICaseSummary {
  caseSummaryId?: number;
  patient?: IPatient;
  patientId?: number;
  caseGuarantor?: ICaseGuarantorItem[];
  caseInsurances?: any[];
  roomId?: number;
  duration?: number;
  procedureStartDt?: string;
  procedureStopDt?: string;
  procedureStartTime?: string;
  procedureStopTime?: string;
  roomName?: string;
  dateOfService?: string;
  caseProcedures?: ICaseProcedure[];
  appointmentTypeId?: number;
  appointmentTypeName?: string;
  caseType?: number;
  additionalClaimInfo?: any;
  primaryPhysicianId?: number;
  [key: string]: any;
}

export default ICaseSummary;