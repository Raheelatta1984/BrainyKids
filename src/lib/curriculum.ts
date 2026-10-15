import type { CurriculumCountry, EducationGrade, EducationStage } from "./types";

export type ResolvedEducationStage = Exclude<EducationStage, "auto" | EducationGrade>;
export type EducationStageOption = { value: EducationStage; label: string; description: string };

export const CURRICULUM_COUNTRIES: {
  code: CurriculumCountry;
  label: string;
  curriculum: string;
  currency: string;
  currencyShort: string;
  unit: string;
  spelling: "colour" | "color";
}[] = [
  { code: "AU", label: "Australia", curriculum: "Australian Curriculum / NAPLAN", currency: "Australian dollars", currencyShort: "A$", unit: "centimetres", spelling: "colour" },
  { code: "GB", label: "United Kingdom", curriculum: "England / GCSE / Cambridge", currency: "pounds", currencyShort: "£", unit: "centimetres", spelling: "colour" },
  { code: "US", label: "United States", curriculum: "Common Core / US grades", currency: "US dollars", currencyShort: "$", unit: "inches", spelling: "color" },
  { code: "IN", label: "India", curriculum: "CBSE / NCERT / Indian classes", currency: "rupees", currencyShort: "₹", unit: "centimetres", spelling: "colour" },
  { code: "PK", label: "Pakistan", curriculum: "National Curriculum / Matric / Cambridge", currency: "rupees", currencyShort: "₨", unit: "centimetres", spelling: "colour" },
  { code: "EU", label: "Europe / International", curriculum: "European / international (metric)", currency: "euros", currencyShort: "€", unit: "centimetres", spelling: "colour" },
  { code: "NZ", label: "New Zealand", curriculum: "New Zealand Curriculum", currency: "New Zealand dollars", currencyShort: "NZ$", unit: "centimetres", spelling: "colour" },
];

const COMMON_STAGES: EducationStageOption[] = [
  { value: "auto", label: "Choose by the child's age", description: "Age-based early years, primary, middle, secondary or A-Level practice" },
  { value: "early-years", label: "Early years", description: "Playful early numeracy and language" },
  { value: "primary", label: "Primary school", description: "Primary / elementary curriculum" },
  { value: "middle-school", label: "Middle school", description: "Middle years, fractions, ratios and science" },
  { value: "secondary", label: "Secondary school", description: "Secondary maths, science and English" },
  { value: "o-level", label: "O-Level / GCSE", description: "Short, exam-style O-Level and GCSE practice" },
  { value: "a-level", label: "A-Level", description: "Concise A-Level maths, physics and statistics practice" },
];

function numberedStages(
  country: CurriculumCountry,
  valuePrefix: string,
  labelPrefix: string,
  count: number,
): EducationStageOption[] {
  const countryName = CURRICULUM_COUNTRIES.find((item) => item.code === country)?.label ?? country;
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      value: `${valuePrefix}${number}` as EducationGrade,
      label: `${labelPrefix} ${number}`,
      description: `${countryName} ${labelPrefix.toLowerCase()} ${number}`,
    };
  });
}

const GRADES_BY_COUNTRY: Record<CurriculumCountry, EducationStageOption[]> = {
  AU: [
    { value: "AU-Foundation", label: "Foundation / Prep", description: "Australian Foundation / Prep year" },
    ...numberedStages("AU", "AU-Year-", "Year", 12),
  ],
  GB: [
    { value: "GB-Reception", label: "Reception", description: "England Reception year" },
    ...numberedStages("GB", "GB-Year-", "Year", 13),
  ],
  US: [
    { value: "US-Kindergarten", label: "Kindergarten", description: "United States Kindergarten" },
    ...numberedStages("US", "US-Grade-", "Grade", 12),
  ],
  IN: numberedStages("IN", "IN-Class-", "Class", 12),
  PK: numberedStages("PK", "PK-Class-", "Class", 12),
  EU: [
    ...numberedStages("EU", "EU-Primary-", "Primary", 6),
    ...numberedStages("EU", "EU-Secondary-", "Secondary", 7),
  ],
  NZ: numberedStages("NZ", "NZ-Year-", "Year", 13),
};

/** Common exam/stage choices plus country-specific school-year or class choices. */
export function educationStagesForCountry(country: CurriculumCountry): EducationStageOption[] {
  return [...COMMON_STAGES, ...GRADES_BY_COUNTRY[country]];
}

export const EDUCATION_STAGES: EducationStageOption[] = [
  ...COMMON_STAGES,
  ...Object.values(GRADES_BY_COUNTRY).flat(),
];

const COUNTRY_CODES = new Set<string>(CURRICULUM_COUNTRIES.map((country) => country.code));
const STAGE_CODES = new Set<string>(EDUCATION_STAGES.map((stage) => stage.value));

export function isCurriculumCountry(value: unknown): value is CurriculumCountry {
  return typeof value === "string" && COUNTRY_CODES.has(value);
}

export function isEducationStage(value: unknown): value is EducationStage {
  return typeof value === "string" && STAGE_CODES.has(value);
}

export function curriculumCountryInfo(code: CurriculumCountry | string | null | undefined) {
  return CURRICULUM_COUNTRIES.find((country) => country.code === code) ?? CURRICULUM_COUNTRIES[0];
}

export function educationGradeCountry(stage: EducationStage | string): CurriculumCountry | null {
  if (stage === "AU-Foundation" || stage.startsWith("AU-Year-")) return "AU";
  if (stage === "GB-Reception" || stage.startsWith("GB-Year-")) return "GB";
  if (stage === "US-Kindergarten" || stage.startsWith("US-Grade-")) return "US";
  if (stage.startsWith("IN-Class-")) return "IN";
  if (stage.startsWith("PK-Class-")) return "PK";
  if (stage.startsWith("EU-Primary-") || stage.startsWith("EU-Secondary-")) return "EU";
  if (stage.startsWith("NZ-Year-")) return "NZ";
  return null;
}

/** The age-based path is intentionally inclusive; a parent can explicitly choose an exam stage. */
export function educationStageForAge(age: number): ResolvedEducationStage {
  if (age <= 4) return "early-years";
  if (age <= 10) return "primary";
  if (age <= 13) return "middle-school";
  if (age <= 16) return "secondary";
  return "a-level";
}

function stageForSelectedGrade(selected: EducationGrade): ResolvedEducationStage {
  if (selected === "GB-Reception") return "early-years";
  if (selected === "AU-Foundation" || selected === "US-Kindergarten") return "primary";
  const match = selected.match(/(?:Year-|Grade-|Class-|Primary-|Secondary-)(\d+)$/);
  const grade = match ? Number(match[1]) : 1;
  if (selected.startsWith("EU-Primary-")) return "primary";
  if (selected.startsWith("EU-Secondary-")) return grade <= 3 ? "middle-school" : "secondary";
  if (selected.startsWith("GB-Year-")) {
    if (grade <= 6) return "primary";
    if (grade <= 9) return "middle-school";
    if (grade <= 11) return "o-level";
    return "a-level";
  }
  if (selected.startsWith("AU-Year-")) {
    if (grade <= 6) return "primary";
    if (grade <= 9) return "middle-school";
    return "secondary";
  }
  if (selected.startsWith("US-Grade-")) {
    if (grade <= 5) return "primary";
    if (grade <= 8) return "middle-school";
    return "secondary";
  }
  if (selected.startsWith("IN-Class-") || selected.startsWith("PK-Class-")) {
    if (grade <= 5) return "primary";
    if (grade <= 8) return "middle-school";
    return "secondary";
  }
  if (selected.startsWith("NZ-Year-")) {
    if (grade <= 6) return "primary";
    if (grade <= 8) return "middle-school";
    return "secondary";
  }
  return "primary";
}

export function resolveEducationStage(
  age: number,
  selected: EducationStage,
  country: CurriculumCountry = "AU",
): ResolvedEducationStage {
  if (selected === "auto") return educationStageForAge(age);
  const gradeCountry = educationGradeCountry(selected);
  if (gradeCountry) return gradeCountry === country ? stageForSelectedGrade(selected as EducationGrade) : educationStageForAge(age);
  return selected as ResolvedEducationStage;
}

export function educationStageLabel(stage: EducationStage): string {
  return EDUCATION_STAGES.find((item) => item.value === stage)?.label ?? "Choose by the child's age";
}
