import type { EducationStage, Gender, CurriculumCountry } from "./types";
import { curriculumCountryInfo, resolveEducationStage, type ResolvedEducationStage } from "./curriculum";
import type { Question, QuestionTemplateKey, Track } from "./quiz-data";

/** A level contains a short, consistent set; new items are generated for every run. */
export const QUESTIONS_PER_LEVEL = 8;

export type QuestionProfile = {
  age: number;
  gender: Gender;
  name: string;
  curriculumCountry: CurriculumCountry;
  educationStage: EducationStage;
};

type QuestionValues = Record<string, string | number>;

type GeneratedSpec = {
  key: QuestionTemplateKey;
  topic: string;
  visual: string;
  question: string;
  explain: string;
  answer: string;
  choices: string[];
  values: QuestionValues;
};

const EARLY_TEMPLATES: QuestionTemplateKey[] = ["addition", "subtraction", "shape", "sequence", "addition", "shape", "subtraction", "sequence"];
const PRIMARY_TEMPLATES: QuestionTemplateKey[] = ["addition", "subtraction", "multiplication", "division", "sequence", "perimeter", "fraction", "money"];
const MIDDLE_TEMPLATES: QuestionTemplateKey[] = ["percentage", "ratio", "average", "area", "fraction", "sequence", "money", "spelling"];
const SECONDARY_TEMPLATES: QuestionTemplateKey[] = ["linear-equation", "percentage", "gradient", "pythagoras", "ohms-law", "ratio", "quadratic", "spelling"];
const O_LEVEL_TEMPLATES: QuestionTemplateKey[] = ["linear-equation", "quadratic", "gradient", "pythagoras", "ohms-law", "molar-mass", "ratio", "percentage"];
const A_LEVEL_TEMPLATES: QuestionTemplateKey[] = ["differentiate", "integrate", "logarithm", "kinematics", "probability", "average", "molar-mass", "linear-equation"];

function templatesFor(stage: ResolvedEducationStage): QuestionTemplateKey[] {
  switch (stage) {
    case "early-years": return EARLY_TEMPLATES;
    case "primary": return PRIMARY_TEMPLATES;
    case "middle-school": return MIDDLE_TEMPLATES;
    case "secondary": return SECONDARY_TEMPLATES;
    case "o-level": return O_LEVEL_TEMPLATES;
    case "a-level": return A_LEVEL_TEMPLATES;
  }
}

/**
 * The options are spaced far enough apart that a distractor is never mistaken
 * for a near-correct numeric answer. The prompt's changing values and puzzle
 * number make each generated item distinct across levels and restarts.
 */
function numericChoices(answer: number, sequence: number): string[] {
  const delta = Math.max(4, Math.ceil(Math.abs(answer) * 0.2) + 2);
  const values = [answer, answer + delta, Math.max(0, answer - delta), answer + delta * 2];
  const rotation = sequence % values.length;
  return [...values.slice(rotation), ...values.slice(0, rotation)].map(String);
}

function withPuzzleNumber(sequence: number, body: string): string {
  return `Puzzle ${sequence}: ${body}`;
}

function numericSpec(
  sequence: number,
  key: QuestionTemplateKey,
  topic: string,
  visual: string,
  body: string,
  explain: string,
  answer: number,
  values: QuestionValues,
): GeneratedSpec {
  return {
    key,
    topic,
    visual,
    question: withPuzzleNumber(sequence, body),
    explain,
    answer: String(answer),
    choices: numericChoices(answer, sequence),
    values: { n: sequence, answer, ...values },
  };
}

function expressionSpec(
  sequence: number,
  key: QuestionTemplateKey,
  topic: string,
  body: string,
  explain: string,
  answer: string,
  choices: string[],
  values: QuestionValues,
): GeneratedSpec {
  return {
    key,
    topic,
    visual: "🧮",
    question: withPuzzleNumber(sequence, body),
    explain,
    answer,
    choices,
    values: { n: sequence, answer, ...values },
  };
}

function makeSpec(
  key: QuestionTemplateKey,
  n: number,
  level: number,
  country: CurriculumCountry,
  stage: ResolvedEducationStage,
): GeneratedSpec {
  const local = curriculumCountryInfo(country);
  const cmUnit = country === "US" ? "in" : "cm";
  const areaUnit = country === "US" ? "square inches" : "square centimetres";
  const difficultyOffset = Math.min(12, Math.floor((n - 1) / 24) + Math.floor((level - 1) / 6));

  switch (key) {
    case "addition": {
      const small = stage === "early-years";
      const a = small ? 1 + ((n * 2) % 8) + Math.floor((n - 1) / 4) * 8 + Math.floor((level - 1) / 2) * 2 : n + 6 + difficultyOffset;
      const b = small ? 1 + ((n * 3) % 7) + Math.floor((n - 1) / 7) * 7 + Math.floor((level - 1) / 3) : 2 * n + 3 + difficultyOffset;
      return numericSpec(n, key, "Addition", "➕", `What is ${a} + ${b}?`, `${a} + ${b} = ${a + b}.`, a + b, { a, b });
    }
    case "subtraction": {
      const small = stage === "early-years";
      const a = small ? 5 + ((n * 3) % 10) + Math.floor((n - 1) / 10) * 10 + Math.floor((level - 1) / 2) * 10 : 3 * n + 18 + difficultyOffset;
      const b = small ? 1 + ((n * 2) % 4) + Math.floor((n - 1) / 10) * 4 : n + 4;
      return numericSpec(n, key, "Subtraction", "➖", `What is ${a} − ${b}?`, `${a} − ${b} = ${a - b}.`, a - b, { a, b });
    }
    case "multiplication": {
      const a = 2 + (n % 8);
      const b = n + 3 + difficultyOffset;
      return numericSpec(n, key, "Multiplication", "✖️", `What is ${a} × ${b}?`, `${a} × ${b} = ${a * b}.`, a * b, { a, b });
    }
    case "division": {
      const divisor = 2 + (n % 7);
      const quotient = n + 4 + difficultyOffset;
      const dividend = divisor * quotient;
      return numericSpec(n, key, "Division", "➗", `What is ${dividend} ÷ ${divisor}?`, `${dividend} ÷ ${divisor} = ${quotient}.`, quotient, { a: dividend, b: divisor, answer: quotient });
    }
    case "sequence": {
      const first = stage === "early-years" ? n : n + 2 + difficultyOffset;
      const step = stage === "early-years" ? 1 : 2 + (n % 5);
      const second = first + step;
      const third = first + 2 * step;
      const answer = first + 3 * step;
      return numericSpec(n, key, "Patterns", "🔢", `What comes next: ${first}, ${second}, ${third}, ___?`, `Add ${step} each time. The next number is ${answer}.`, answer, { a: first, b: second, c: third, step });
    }
    case "shape": {
      const sides = n + 3;
      const knownNames: Record<number, string> = { 3: "triangle", 4: "square", 5: "pentagon", 6: "hexagon", 7: "heptagon", 8: "octagon", 9: "nonagon", 10: "decagon" };
      const name = knownNames[sides] ?? `${sides}-sided polygon`;
      return numericSpec(n, key, "Shapes", "🔺", `A regular ${name} has how many sides?`, `A regular ${name} has ${sides} sides.`, sides, { shape: name, answer: sides });
    }
    case "perimeter": {
      const length = n + 5 + difficultyOffset;
      const width = n + 2;
      const answer = 2 * (length + width);
      return numericSpec(n, key, "Perimeter", "📐", `A rectangle is ${length} ${cmUnit} by ${width} ${cmUnit}. What is its perimeter?`, `Perimeter = 2 × (${length} + ${width}) = ${answer} ${cmUnit}.`, answer, { a: length, b: width, answer, unit: cmUnit });
    }
    case "area": {
      const length = n + 4 + difficultyOffset;
      const width = n + 2;
      const answer = length * width;
      return numericSpec(n, key, "Area", "📐", `A rectangle is ${length} ${cmUnit} by ${width} ${cmUnit}. What is its area?`, `Area = ${length} × ${width} = ${answer} ${areaUnit}.`, answer, { a: length, b: width, answer, unit: areaUnit });
    }
    case "fraction": {
      const numerator = 1 + (n % 5);
      const denominator = numerator * 2;
      const multiplier = n + 2;
      const newDenominator = denominator * multiplier;
      const answer = numerator * multiplier;
      return numericSpec(n, key, "Fractions", "🍕", `Write ${numerator}/${denominator} with denominator ${newDenominator}. What is the new numerator?`, `${numerator}/${denominator} = ${answer}/${newDenominator}.`, answer, { a: numerator, b: denominator, c: newDenominator, answer });
    }
    case "percentage": {
      const rate = 10 * (1 + (n % 8));
      const amount = 100 * (n + 2 + difficultyOffset);
      const answer = (rate * amount) / 100;
      return numericSpec(n, key, "Percentages", "%", `What is ${rate}% of ${amount}?`, `${rate}% of ${amount} = ${answer}.`, answer, { a: rate, b: amount, answer });
    }
    case "ratio": {
      const firstPart = 2 + (n % 5);
      const secondPart = 3 + (n % 7);
      const scale = n + 2;
      const answer = secondPart * scale;
      return numericSpec(n, key, "Ratio", "⚖️", `Scale the ratio ${firstPart}:${secondPart} by ${scale}. What is the second part?`, `The second part is ${secondPart} × ${scale} = ${answer}.`, answer, { a: firstPart, b: secondPart, c: scale, answer });
    }
    case "average": {
      const a = n + 2;
      const b = n + 8;
      const c = n + 14;
      const answer = n + 8;
      return numericSpec(n, key, "Averages", "📊", `Find the mean of ${a}, ${b} and ${c}.`, `(${a} + ${b} + ${c}) ÷ 3 = ${answer}.`, answer, { a, b, c, answer });
    }
    case "spelling": {
      const correct = local.spelling;
      const alternate = correct === "colour" ? "color" : "colour";
      return expressionSpec(
        n,
        key,
        "Spelling",
        `Which spelling is standard in ${local.label} English: “${correct}” or “${alternate}”?`,
        `Both forms are used, but ${local.label} English uses “${correct}”.`,
        correct,
        [correct, alternate],
        { country: local.label, a: correct, b: alternate, answer: correct },
      );
    }
    case "money": {
      const price = n + 2;
      const quantity = 2 + (n % 4);
      const answer = price * quantity;
      return numericSpec(n, key, "Money", "🪙", `One notebook costs ${price} ${local.currency}. What do ${quantity} notebooks cost?`, `${price} × ${quantity} = ${answer} ${local.currency}.`, answer, { a: price, b: quantity, answer, currency: local.currency, currencyShort: local.currencyShort, country });
    }
    case "linear-equation": {
      const coefficient = 2 + (n % 5);
      const x = n + 2 + difficultyOffset;
      const constant = 3 + (n % 9);
      const total = coefficient * x + constant;
      return numericSpec(n, key, "Algebra", "🧮", `Solve: ${coefficient}x + ${constant} = ${total}.`, `${coefficient}x = ${total} − ${constant}; x = ${x}.`, x, { a: coefficient, b: constant, c: total, answer: x });
    }
    case "quadratic": {
      const root = n + 2 + difficultyOffset;
      const otherRoot = root + 3;
      const sum = root + otherRoot;
      const product = root * otherRoot;
      return numericSpec(n, key, "Quadratics", "🧮", `One root of x² − ${sum}x + ${product} = 0 is ${root}. Find the other root.`, `The roots add to ${sum}. The other root is ${sum} − ${root} = ${otherRoot}.`, otherRoot, { a: sum, b: product, c: root, answer: otherRoot });
    }
    case "gradient": {
      const run = 2 + (n % 4);
      const slope = 1 + (n % 6);
      const x1 = n + 1;
      const y1 = 2 * n + 3;
      const x2 = x1 + run;
      const y2 = y1 + slope * run;
      return numericSpec(n, key, "Coordinate geometry", "📈", `Find the gradient from (${x1}, ${y1}) to (${x2}, ${y2}).`, `Gradient = (${y2} − ${y1}) ÷ (${x2} − ${x1}) = ${slope}.`, slope, { a: x1, b: y1, c: x2, d: y2, answer: slope });
    }
    case "pythagoras": {
      const scale = n + 1;
      const a = 3 * scale;
      const b = 4 * scale;
      const answer = 5 * scale;
      return numericSpec(n, key, "Pythagoras", "📐", `A right triangle has shorter sides ${a} and ${b}. Find the hypotenuse.`, `Using 3–4–5, the hypotenuse is ${answer}.`, answer, { a, b, answer });
    }
    case "ohms-law": {
      const current = n + 1;
      const resistance = 2 + (n % 7);
      const voltage = current * resistance;
      return numericSpec(n, key, "Physics · electricity", "⚡", `A ${resistance} Ω resistor carries ${current} A. Find the voltage.`, `V = I × R = ${current} × ${resistance} = ${voltage} V.`, voltage, { a: resistance, b: current, answer: voltage });
    }
    case "molar-mass": {
      const moles = n + 1;
      const molarMass = 12 + (n % 16);
      const mass = moles * molarMass;
      return numericSpec(n, key, "Chemistry · moles", "🧪", `${moles} mol has a molar mass of ${molarMass} g/mol. Find the mass.`, `Mass = moles × molar mass = ${moles} × ${molarMass} = ${mass} g.`, mass, { a: moles, b: molarMass, answer: mass });
    }
    case "differentiate": {
      const coefficient = n + 2;
      const power = 2 + (n % 5);
      const derivativeCoefficient = coefficient * power;
      const answer = `${derivativeCoefficient}x^${power - 1}`;
      const choices = [answer, `${coefficient}x^${power}`, `${derivativeCoefficient}x^${power}`, `${coefficient}x^${power - 1}`];
      return expressionSpec(n, key, "A-Level calculus · differentiation", `Differentiate f(x) = ${coefficient}x^${power}.`, `Apply the power rule: f′(x) = ${derivativeCoefficient}x^${power - 1}.`, answer, choices, { a: coefficient, b: power, c: derivativeCoefficient, answer });
    }
    case "integrate": {
      const coefficient = n + 2;
      const power = 1 + (n % 4);
      const nextPower = power + 1;
      const answer = `${coefficient}/${nextPower}x^${nextPower} + C`;
      const choices = [answer, `${coefficient}x^${power} + C`, `${coefficient}/${power}x^${power} + C`, `${coefficient}x^${nextPower} + C`];
      return expressionSpec(n, key, "A-Level calculus · integration", `Integrate ${coefficient}x^${power} dx.`, `∫${coefficient}x^${power} dx = ${answer}.`, answer, choices, { a: coefficient, b: power, c: nextPower, answer });
    }
    case "logarithm": {
      const base = 2 + (n % 5);
      const exponent = n + 3;
      return numericSpec(n, key, "A-Level logarithms", "📐", `Evaluate log${base}(${base}^${exponent}).`, `log${base}(${base}^${exponent}) = ${exponent}.`, exponent, { a: base, b: exponent, answer: exponent });
    }
    case "kinematics": {
      const initialVelocity = n + 2;
      const acceleration = 2 + (n % 6);
      const time = 2 + (n % 4);
      const finalVelocity = initialVelocity + acceleration * time;
      return numericSpec(n, key, "A-Level mechanics", "🚀", `A body starts at ${initialVelocity} m/s and accelerates at ${acceleration} m/s² for ${time} s. Find its final speed.`, `v = u + at = ${initialVelocity} + ${acceleration} × ${time} = ${finalVelocity} m/s.`, finalVelocity, { a: initialVelocity, b: acceleration, c: time, answer: finalVelocity });
    }
    case "probability": {
      const favourable = n + 1;
      const total = 3 * n + 5;
      const answer = `${favourable}/${total}`;
      const choices = [answer, `${favourable + 1}/${total}`, `${favourable}/${total + 2}`, `${total - favourable}/${total}`];
      return expressionSpec(n, key, "Probability", `There are ${favourable} winning outcomes in ${total}. What is the probability of winning?`, `Probability = winning outcomes ÷ total outcomes = ${answer}.`, answer, choices, { a: favourable, b: total, answer });
    }
  }
}

function questionTier(stage: ResolvedEducationStage, level: number): Question["level"] {
  if (stage === "early-years") return level <= 1 ? 1 : level === 2 ? 2 : 3;
  if (stage === "primary") return level <= 1 ? 1 : level === 2 ? 2 : 3;
  if (stage === "middle-school") return level <= 2 ? 2 : 3;
  return 3;
}

/**
 * Build a fresh, deterministic question. The server chooses the sequence number
 * from the child's lifetime question history, so client refreshes and level
 * jumps cannot cause an item to be reused. Gender deliberately does not narrow
 * subjects or difficulty: learning standards stay equal and stereotype-free.
 */
export function generateQuestion(sequenceIndex: number, level: number, profile: QuestionProfile): Question {
  const sequence = Math.max(1, Math.floor(sequenceIndex) + 1);
  const stage = resolveEducationStage(profile.age, profile.educationStage, profile.curriculumCountry);
  const templates = templatesFor(stage);
  const key = templates[(sequence - 1) % templates.length];
  const spec = makeSpec(key, sequence, level, profile.curriculumCountry, stage);
  const track: Track = stage === "early-years" ? "early" : stage === "o-level" || stage === "a-level" ? "selective" : "naplan";
  // Keep a simple learning-profile marker on the generated item, but not on
  // the visible prompt: the puzzle number and its changed values ensure it is
  // visibly distinct without cluttering O/A-Level exam-style questions.
  return {
    id: `fresh-${sequence.toString(36)}`,
    level: questionTier(stage, level),
    track,
    topic: spec.topic,
    question: spec.question,
    visual: spec.visual,
    choices: spec.choices,
    answer: spec.answer,
    explain: spec.explain,
    templateKey: spec.key,
    templateValues: {
      ...spec.values,
      country: profile.curriculumCountry,
      currency: spec.values.currency ?? curriculumCountryInfo(profile.curriculumCountry).currency,
      currencyShort: spec.values.currencyShort ?? curriculumCountryInfo(profile.curriculumCountry).currencyShort,
      stage,
      age: profile.age,
      level,
      // A name is included as an optional non-gendered learner context for translations.
      learner: profile.name,
      gender: profile.gender,
    },
  };
}
