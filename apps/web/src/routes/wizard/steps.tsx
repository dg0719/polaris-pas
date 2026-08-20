import { money, planLabel, planName, useLabel } from '../../lib/format.ts';
import type { Driver, ProductDefinition, Vehicle } from '../../lib/types.ts';
import { Button, Choice, Field, Select, TextInput } from '../../components/ui.tsx';
import { DEFAULT_COVERAGE, type VehicleCoverage, type WizardForm } from './model.ts';

type Update = (patch: Partial<WizardForm>) => void;

/** Step 1: when cover starts, how long for, and how it gets paid. */
export function PolicyStep({ form, update }: { form: WizardForm; update: Update }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-7)', maxWidth: '48rem' }}>
      <div className="form-grid">
        <Field label="Effective date" hint="Cover starts at 12:01am on this day.">
          {(props) => (
            <TextInput
              {...props}
              type="date"
              value={form.effectiveDate}
              onChange={(event) => update({ effectiveDate: event.target.value })}
            />
          )}
        </Field>
        <Field label="Term">
          {(props) => (
            <Select
              {...props}
              value={String(form.termMonths)}
              onChange={(event) => update({ termMonths: Number(event.target.value) })}
            >
              <option value="12">12 months</option>
              <option value="6">6 months</option>
            </Select>
          )}
        </Field>
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field__label" style={{ marginBottom: 'var(--s-3)' }}>
          Billing plan
        </legend>
        <div className="choices">
          {(['full', 'monthly', 'quarterly'] as const).map((plan) => (
            <Choice
              key={plan}
              name="billingPlan"
              value={plan}
              checked={form.billingPlan === plan}
              onChange={(value) => update({ billingPlan: value as WizardForm['billingPlan'] })}
              title={planName(plan)}
              note={planLabel(plan)}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** Step 2: the people. Driving history is what trips underwriting rules. */
export function DriversStep({ form, update }: { form: WizardForm; update: Update }) {
  const patch = (index: number, changes: Partial<Driver>) =>
    update({
      drivers: form.drivers.map((driver, i) => (i === index ? { ...driver, ...changes } : driver)),
    });

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      {form.drivers.map((driver, index) => (
        <div key={driver.id} className="stack" style={{ gap: 'var(--s-5)' }}>
          <div className="section__head" style={{ marginBottom: 0 }}>
            <h3>
              Driver {index + 1}
              {driver.firstName || driver.lastName ? `: ${driver.firstName} ${driver.lastName}` : ''}
            </h3>
            {form.drivers.length > 1 ? (
              <Button
                variant="ghost"
                onClick={() => update({ drivers: form.drivers.filter((_, i) => i !== index) })}
              >
                Remove
              </Button>
            ) : null}
          </div>

          <div className="form-grid">
            <Field label="First name">
              {(props) => (
                <TextInput
                  {...props}
                  value={driver.firstName}
                  onChange={(event) => patch(index, { firstName: event.target.value })}
                />
              )}
            </Field>
            <Field label="Last name">
              {(props) => (
                <TextInput
                  {...props}
                  value={driver.lastName}
                  onChange={(event) => patch(index, { lastName: event.target.value })}
                />
              )}
            </Field>
            <Field label="Date of birth">
              {(props) => (
                <TextInput
                  {...props}
                  type="date"
                  value={driver.dateOfBirth}
                  onChange={(event) => patch(index, { dateOfBirth: event.target.value })}
                />
              )}
            </Field>
            <Field label="Licence number">
              {(props) => (
                <TextInput
                  {...props}
                  value={driver.licenceNumber}
                  placeholder="D1234-56789-01234"
                  onChange={(event) => patch(index, { licenceNumber: event.target.value })}
                />
              )}
            </Field>
          </div>

          <div className="form-grid form-grid--narrow">
            <Field label="Years licensed" hint="Under 1 year refers to underwriting.">
              {(props) => (
                <TextInput
                  {...props}
                  type="number"
                  min="0"
                  max="80"
                  value={driver.yearsLicensed}
                  onChange={(event) => patch(index, { yearsLicensed: Number(event.target.value) })}
                />
              )}
            </Field>
            <Field label="At-fault claims" hint="Last 6 years. Two or more refers.">
              {(props) => (
                <TextInput
                  {...props}
                  type="number"
                  min="0"
                  max="20"
                  value={driver.atFaultClaims}
                  onChange={(event) => patch(index, { atFaultClaims: Number(event.target.value) })}
                />
              )}
            </Field>
            <Field label="Minor convictions" hint="Last 3 years.">
              {(props) => (
                <TextInput
                  {...props}
                  type="number"
                  min="0"
                  max="20"
                  value={driver.minorConvictions}
                  onChange={(event) =>
                    patch(index, { minorConvictions: Number(event.target.value) })
                  }
                />
              )}
            </Field>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Step 3: the cars. Rate group and garaging postal code drive the price. */
export function VehiclesStep({ form, update }: { form: WizardForm; update: Update }) {
  const patch = (index: number, changes: Partial<Vehicle>) =>
    update({
      vehicles: form.vehicles.map((vehicle, i) =>
        i === index ? { ...vehicle, ...changes } : vehicle,
      ),
    });

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      {form.vehicles.map((vehicle, index) => (
        <div key={vehicle.id} className="stack" style={{ gap: 'var(--s-5)' }}>
          <div className="section__head" style={{ marginBottom: 0 }}>
            <h3>
              Vehicle {index + 1}
              {vehicle.make ? `: ${vehicle.year} ${vehicle.make} ${vehicle.model}` : ''}
            </h3>
            {form.vehicles.length > 1 ? (
              <Button
                variant="ghost"
                onClick={() => {
                  const { [vehicle.id]: _removed, ...rest } = form.coverages;
                  update({ vehicles: form.vehicles.filter((_, i) => i !== index), coverages: rest });
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>

          <div className="form-grid form-grid--narrow">
            <Field label="Year">
              {(props) => (
                <TextInput
                  {...props}
                  type="number"
                  min="1900"
                  max="2100"
                  value={vehicle.year}
                  onChange={(event) => patch(index, { year: Number(event.target.value) })}
                />
              )}
            </Field>
            <Field label="Make">
              {(props) => (
                <TextInput
                  {...props}
                  value={vehicle.make}
                  onChange={(event) => patch(index, { make: event.target.value })}
                />
              )}
            </Field>
            <Field label="Model">
              {(props) => (
                <TextInput
                  {...props}
                  value={vehicle.model}
                  onChange={(event) => patch(index, { model: event.target.value })}
                />
              )}
            </Field>
          </div>

          <div className="form-grid">
            <Field label="VIN">
              {(props) => (
                <TextInput
                  {...props}
                  value={vehicle.vin}
                  onChange={(event) => patch(index, { vin: event.target.value.toUpperCase() })}
                />
              )}
            </Field>
            <Field label="Principal driver">
              {(props) => (
                <Select
                  {...props}
                  value={vehicle.principalDriverId}
                  onChange={(event) => patch(index, { principalDriverId: event.target.value })}
                >
                  {form.drivers.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.firstName} {driver.lastName}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Garaging postal code" hint="Sets the rating territory.">
              {(props) => (
                <TextInput
                  {...props}
                  value={vehicle.postalCode}
                  placeholder="K1A 0A1"
                  onChange={(event) => patch(index, { postalCode: event.target.value.toUpperCase() })}
                />
              )}
            </Field>
          </div>

          <div className="form-grid form-grid--narrow">
            <Field label="Value" hint="Over $150,000 refers.">
              {(props) => (
                <TextInput
                  {...props}
                  type="number"
                  min="0"
                  step="100"
                  value={vehicle.valueCents / 100}
                  onChange={(event) =>
                    patch(index, { valueCents: Math.round(Number(event.target.value) * 100) })
                  }
                />
              )}
            </Field>
            <Field label="Rate group" hint="1 to 20.">
              {(props) => (
                <TextInput
                  {...props}
                  type="number"
                  min="1"
                  max="20"
                  value={vehicle.rateGroup}
                  onChange={(event) => patch(index, { rateGroup: Number(event.target.value) })}
                />
              )}
            </Field>
            <Field label="Annual kilometres">
              {(props) => (
                <TextInput
                  {...props}
                  type="number"
                  min="0"
                  step="500"
                  value={vehicle.annualKm}
                  onChange={(event) => patch(index, { annualKm: Number(event.target.value) })}
                />
              )}
            </Field>
            <Field label="Primary use">
              {(props) => (
                <Select
                  {...props}
                  value={vehicle.primaryUse}
                  onChange={(event) =>
                    patch(index, { primaryUse: event.target.value as Vehicle['primaryUse'] })
                  }
                >
                  {(['commute', 'pleasure', 'business'] as const).map((value) => (
                    <option key={value} value={value}>
                      {useLabel(value)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Step 4: coverages per vehicle. Mandatory ones are stated, not offered. */
export function CoveragesStep({
  form,
  update,
  product,
}: {
  form: WizardForm;
  update: Update;
  product: ProductDefinition;
}) {
  const mandatory = product.coverages.filter((c) => c.mandatory);
  const endorsements = product.coverages.filter((c) => c.kind === 'endorsement');
  const liability = product.coverages.find((c) => c.limitOptionsCents);
  const physical = product.coverages.find((c) => c.deductibleOptionsCents);

  const setCoverage = (vehicleId: string, changes: Partial<VehicleCoverage>) =>
    update({
      coverages: {
        ...form.coverages,
        [vehicleId]: { ...(form.coverages[vehicleId] ?? DEFAULT_COVERAGE), ...changes },
      },
    });

  return (
    <div className="stack" style={{ gap: 'var(--s-8)' }}>
      {form.vehicles.map((vehicle) => {
        const choice = form.coverages[vehicle.id] ?? DEFAULT_COVERAGE;
        return (
          <div key={vehicle.id} className="stack" style={{ gap: 'var(--s-5)' }}>
            <h3>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h3>

            <p className="section__note">
              Compulsory in Ontario and always included:{' '}
              {mandatory.map((c) => c.name).join(', ')}.
            </p>

            {liability ? (
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="field__label" style={{ marginBottom: 'var(--s-3)' }}>
                  Third party liability limit
                </legend>
                <div className="choices">
                  {liability.limitOptionsCents!.map((limit) => (
                    <Choice
                      key={limit}
                      name={`limit-${vehicle.id}`}
                      value={String(limit)}
                      checked={choice.liabilityLimitCents === limit}
                      onChange={(value) => setCoverage(vehicle.id, { liabilityLimitCents: Number(value) })}
                      title={money(limit)}
                    />
                  ))}
                </div>
              </fieldset>
            ) : null}

            <div>
              <label className="toggle-row" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={choice.physicalDamage}
                  onChange={(event) =>
                    setCoverage(vehicle.id, { physicalDamage: event.target.checked })
                  }
                />
                <span className="toggle-row__body">
                  <span className="toggle-row__name">Collision and Comprehensive</span>
                  <span className="toggle-row__note">
                    Damage to this vehicle. Leave off for third-party-only cover.
                  </span>
                </span>
              </label>
            </div>

            {choice.physicalDamage && physical ? (
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="field__label" style={{ marginBottom: 'var(--s-3)' }}>
                  Deductible
                </legend>
                <div className="choices">
                  {physical.deductibleOptionsCents!.map((deductible) => (
                    <Choice
                      key={deductible}
                      name={`deductible-${vehicle.id}`}
                      value={String(deductible)}
                      checked={choice.deductibleCents === deductible}
                      onChange={(value) => setCoverage(vehicle.id, { deductibleCents: Number(value) })}
                      title={money(deductible)}
                      note={deductible === 100_000 ? 'Standard' : undefined}
                    />
                  ))}
                </div>
              </fieldset>
            ) : null}

            <div>
              <p className="field__label" style={{ marginBottom: 'var(--s-2)' }}>
                Endorsements
              </p>
              {endorsements.map((endorsement) => (
                <label key={endorsement.code} className="toggle-row" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={choice.endorsements.includes(endorsement.code)}
                    onChange={(event) =>
                      setCoverage(vehicle.id, {
                        endorsements: event.target.checked
                          ? [...choice.endorsements, endorsement.code]
                          : choice.endorsements.filter((code) => code !== endorsement.code),
                      })
                    }
                  />
                  <span className="toggle-row__body">
                    <span className="toggle-row__name">{endorsement.name}</span>
                    <span className="toggle-row__note">
                      {money(endorsement.baseRateCents)} a year, flat
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
