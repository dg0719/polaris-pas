import type {
  CoverageSelection,
  Driver,
  InstallmentPlan,
  ProductDefinition,
  RiskData,
  Vehicle,
} from '../../lib/types.ts';

/** Per-vehicle coverage choices, kept in the shape the wizard asks about. */
export interface VehicleCoverage {
  liabilityLimitCents: number;
  physicalDamage: boolean;
  deductibleCents: number;
  endorsements: string[];
}

export interface WizardForm {
  effectiveDate: string;
  termMonths: number;
  billingPlan: InstallmentPlan;
  drivers: Driver[];
  vehicles: Vehicle[];
  coverages: Record<string, VehicleCoverage>;
}

export const DEFAULT_COVERAGE: VehicleCoverage = {
  liabilityLimitCents: 100_000_000,
  physicalDamage: true,
  deductibleCents: 100_000,
  endorsements: [],
};

let counter = 0;
const nextId = (prefix: string) => `${prefix}${++counter}`;

export function blankDriver(): Driver {
  return {
    id: nextId('d'),
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    licenceNumber: '',
    yearsLicensed: 5,
    atFaultClaims: 0,
    minorConvictions: 0,
  };
}

export function blankVehicle(principalDriverId: string, postalCode: string): Vehicle {
  return {
    id: nextId('v'),
    year: new Date().getUTCFullYear() - 2,
    make: '',
    model: '',
    vin: '',
    valueCents: 3_000_000,
    rateGroup: 10,
    primaryUse: 'commute',
    annualKm: 16_000,
    postalCode,
    principalDriverId,
  };
}

/** Fold the wizard's answers into the risk shape the rating engine expects. */
export function toRiskData(form: WizardForm, product: ProductDefinition): RiskData {
  const selections: CoverageSelection[] = [];

  for (const vehicle of form.vehicles) {
    const choice = form.coverages[vehicle.id] ?? DEFAULT_COVERAGE;

    for (const coverage of product.coverages) {
      if (coverage.mandatory) {
        selections.push({
          vehicleId: vehicle.id,
          coverageCode: coverage.code,
          ...(coverage.limitOptionsCents ? { limitCents: choice.liabilityLimitCents } : {}),
        });
      } else if (coverage.kind === 'physicalDamage' && choice.physicalDamage) {
        selections.push({
          vehicleId: vehicle.id,
          coverageCode: coverage.code,
          deductibleCents: choice.deductibleCents,
        });
      } else if (coverage.kind === 'endorsement' && choice.endorsements.includes(coverage.code)) {
        selections.push({ vehicleId: vehicle.id, coverageCode: coverage.code });
      }
    }
  }

  return {
    termMonths: form.termMonths,
    drivers: form.drivers,
    vehicles: form.vehicles,
    coverages: selections,
  };
}

export interface StepProblem {
  field: string;
  message: string;
}

export function validatePolicy(form: WizardForm): StepProblem[] {
  const problems: StepProblem[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate)) {
    problems.push({ field: 'effectiveDate', message: 'Pick the day cover starts.' });
  }
  return problems;
}

export function validateDrivers(form: WizardForm): StepProblem[] {
  const problems: StepProblem[] = [];
  if (form.drivers.length === 0) {
    problems.push({ field: 'drivers', message: 'A policy needs at least one driver.' });
  }
  form.drivers.forEach((driver, index) => {
    const where = `drivers.${index}`;
    if (!driver.firstName.trim() || !driver.lastName.trim()) {
      problems.push({ field: `${where}.name`, message: 'Both names are required.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(driver.dateOfBirth)) {
      problems.push({ field: `${where}.dateOfBirth`, message: 'Date of birth is required.' });
    }
    if (!driver.licenceNumber.trim()) {
      problems.push({ field: `${where}.licenceNumber`, message: 'Licence number is required.' });
    }
  });
  return problems;
}

export function validateVehicles(form: WizardForm): StepProblem[] {
  const problems: StepProblem[] = [];
  if (form.vehicles.length === 0) {
    problems.push({ field: 'vehicles', message: 'Add the vehicle you are insuring.' });
  }
  form.vehicles.forEach((vehicle, index) => {
    const where = `vehicles.${index}`;
    if (!vehicle.make.trim() || !vehicle.model.trim()) {
      problems.push({ field: `${where}.model`, message: 'Make and model are required.' });
    }
    if (!vehicle.vin.trim()) {
      problems.push({ field: `${where}.vin`, message: 'VIN is required.' });
    }
    if (!/^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(vehicle.postalCode)) {
      problems.push({
        field: `${where}.postalCode`,
        message: 'Garaging postal code must look like K1A 0A1.',
      });
    }
    if (!form.drivers.some((driver) => driver.id === vehicle.principalDriverId)) {
      problems.push({ field: `${where}.principalDriverId`, message: 'Pick a principal driver.' });
    }
  });
  return problems;
}
