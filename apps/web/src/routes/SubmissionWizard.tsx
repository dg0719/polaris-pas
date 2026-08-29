import { useMemo, useState } from 'react';
import { request, useMutation, useQuery } from '../lib/api.ts';
import { addDaysIso, date, money, planName, todayIso } from '../lib/format.ts';
import { findPlan, firstPaymentCents, usePaymentPlans } from '../lib/plans.ts';
import { Link, useRouter } from '../lib/router.tsx';
import type { Account, Job, ProductDefinition } from '../lib/types.ts';
import {
  Button,
  Fact,
  Facts,
  Money,
  Notice,
  PageHead,
  Status,
} from '../components/ui.tsx';
import {
  DEFAULT_COVERAGE,
  blankDriver,
  blankVehicle,
  toRiskData,
  validateDrivers,
  validatePolicy,
  validateVehicles,
  type WizardForm,
} from './wizard/model.ts';
import { CoveragesStep, DriversStep, PolicyStep, VehiclesStep } from './wizard/steps.tsx';

const STEPS = ['Policy', 'Drivers', 'Vehicles', 'Coverages', 'Review'] as const;
const PRODUCT_CODE = 'ON_PA';

export function SubmissionWizard({ accountId }: { accountId: string }) {
  const { navigate } = useRouter();
  const account = useQuery<{ account: Account }>(`/accounts/${accountId}`);
  const product = useQuery<{ product: ProductDefinition }>(`/products/${PRODUCT_CODE}`);

  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [form, setForm] = useState<WizardForm>(() => {
    const driver = blankDriver();
    const vehicle = blankVehicle(driver.id, '');
    return {
      effectiveDate: addDaysIso(todayIso(), 7),
      termMonths: 12,
      billingPlan: 'monthly',
      drivers: [driver],
      vehicles: [vehicle],
      coverages: { [vehicle.id]: { ...DEFAULT_COVERAGE } },
    };
  });

  // The insured's own postal code is the sensible default for garaging.
  const accountPostal = account.data?.account.address.postalCode;
  const [seededPostal, setSeededPostal] = useState(false);
  if (accountPostal && !seededPostal) {
    setSeededPostal(true);
    setForm((current) => ({
      ...current,
      vehicles: current.vehicles.map((vehicle) =>
        vehicle.postalCode ? vehicle : { ...vehicle, postalCode: accountPostal },
      ),
    }));
  }

  const save = useMutation<{ risk: unknown }, { job: Job }>(async ({ risk }) => {
    if (jobId) {
      return request<{ job: Job }>(`/jobs/${jobId}/risk`, { method: 'PUT', body: { risk } });
    }
    return request<{ job: Job }>(`/accounts/${accountId}/submissions`, {
      method: 'POST',
      body: {
        productCode: PRODUCT_CODE,
        effectiveDate: form.effectiveDate,
        billingPlan: form.billingPlan,
        risk,
      },
    });
  });

  const quote = useMutation<void, { job: Job }>(() =>
    request<{ job: Job }>(`/jobs/${jobId}/quote`, { method: 'POST' }),
  );

  const [quoted, setQuoted] = useState<Job | null>(null);

  const problems = useMemo(() => {
    if (step === 0) return validatePolicy(form);
    if (step === 1) return validateDrivers(form);
    if (step === 2) return validateVehicles(form);
    return [];
  }, [step, form]);

  const update = (patch: Partial<WizardForm>) =>
    setForm((current) => ({ ...current, ...patch }));

  async function next() {
    if (problems.length > 0) return;

    // From the vehicles step onward the risk is complete enough to persist, so
    // the submission survives a reload from here.
    if (step >= 2 && product.data) {
      const risk = toRiskData(form, product.data.product);
      const result = await save.run({ risk });
      if (!result) return;
      setJobId(result.job.id);

      if (step === 3) {
        const rated = await quote.run();
        if (!rated) return;
        setQuoted(rated.job);
      }
    }

    const target = Math.min(step + 1, STEPS.length - 1);
    setStep(target);
    setReached((r) => Math.max(r, target));
  }

  const busy = save.pending || quote.pending;
  const error = save.error ?? quote.error;

  return (
    <>
      <PageHead
        eyebrow={
          <Link to={`/accounts/${accountId}`} className="link">
            {account.data?.account.name ?? 'Account'}
          </Link>
        }
        title="New submission"
        meta={
          <>
            <span>Ontario Personal Automobile</span>
            <span>Effective {date(form.effectiveDate)}</span>
            {jobId ? <Status value="Draft" label="Saved as draft" /> : null}
          </>
        }
      />

      <nav className="steps" aria-label="Submission steps">
        {STEPS.map((label, index) => (
          <button
            key={label}
            type="button"
            className="step"
            data-state={index === step ? 'current' : index <= reached ? 'done' : 'todo'}
            disabled={index > reached}
            aria-current={index === step ? 'step' : undefined}
            onClick={() => setStep(index)}
          >
            <span className="step__index">{index + 1}</span>
            <span>{label}</span>
            {index === step ? <span className="sr-only"> (current step)</span> : null}
          </button>
        ))}
      </nav>

      <div className="step-panel" key={step}>
        {error ? <Notice tone="error">{error.message}</Notice> : null}

        {problems.length > 0 && step <= 2 ? (
          <div style={{ marginBottom: 'var(--s-6)' }}>
            <Notice tone="error">
              {problems.length === 1
                ? problems[0]!.message
                : `${problems.length} things need fixing before you can continue.`}
            </Notice>
          </div>
        ) : null}

        {step === 0 ? (
          <PolicyStep
            form={form}
            update={update}
            productCode={PRODUCT_CODE}
            province={account.data?.account.address.province}
          />
        ) : null}

        {step === 1 ? (
          <>
            <DriversStep form={form} update={update} />
            <div style={{ marginTop: 'var(--s-6)' }}>
              <Button onClick={() => update({ drivers: [...form.drivers, blankDriver()] })}>
                Add another driver
              </Button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <VehiclesStep form={form} update={update} />
            <div style={{ marginTop: 'var(--s-6)' }}>
              <Button
                onClick={() => {
                  const vehicle = blankVehicle(
                    form.drivers[0]?.id ?? '',
                    accountPostal ?? form.vehicles[0]?.postalCode ?? '',
                  );
                  update({
                    vehicles: [...form.vehicles, vehicle],
                    coverages: { ...form.coverages, [vehicle.id]: { ...DEFAULT_COVERAGE } },
                  });
                }}
              >
                Add another vehicle
              </Button>
            </div>
          </>
        ) : null}

        {step === 3 && product.data ? (
          <CoveragesStep form={form} update={update} product={product.data.product} />
        ) : null}

        {step === 4 ? (
          <Review
            job={quoted}
            form={form}
            province={account.data?.account.address.province}
            onOpenJob={() => jobId && navigate(`/jobs/${jobId}`)}
          />
        ) : null}
      </div>

      <div className="wizard-foot">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Back
        </Button>

        {step < STEPS.length - 1 ? (
          <Button
            variant="primary"
            loading={busy}
            disabled={problems.length > 0}
            onClick={() => void next()}
          >
            {step === 3 ? 'Rate this submission' : 'Continue'}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => jobId && navigate(`/jobs/${jobId}`)}>
            Open the job
          </Button>
        )}
      </div>
    </>
  );
}

function Review({
  job,
  form,
  province,
  onOpenJob,
}: {
  job: Job | null;
  form: WizardForm;
  province: string | undefined;
  onOpenJob: () => void;
}) {
  const { plans } = usePaymentPlans(PRODUCT_CODE, province);
  const plan = findPlan(plans, form.billingPlan);

  if (!job?.quote) {
    return <Notice>Rating did not return a quote. Go back and check the coverages.</Notice>;
  }

  const { quote } = job;
  const referred = quote.referrals.length > 0;

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <Facts>
        <Fact label="Annual premium" lead>
          {money(quote.annualPremiumCents)}
        </Fact>
        <Fact label="Due at inception" lead>
          <Money cents={firstPaymentCents(quote.annualPremiumCents, plan)} />
          <span className="cell-sub">
            Before fees and tax. The schedule is written when the policy is issued.
          </span>
        </Fact>
        <Fact label="Term">
          {date(quote.termStart)} → {date(quote.termEnd)}
        </Fact>
        <Fact label="Billing">{planName(form.billingPlan, plans)}</Fact>
      </Facts>

      {referred ? (
        <div className="stack stack--tight">
          <Notice tone="flag">
            <strong>Referred to underwriting.</strong> An underwriter has to accept this before it
            can be bound.
          </Notice>
          <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">Reason</th>
                <th scope="col">Value on this risk</th>
              </tr>
            </thead>
            <tbody>
              {quote.referrals.map((referral) => (
                <tr key={referral.ruleCode} className="is-flagged">
                  <td className="mono">{referral.ruleCode}</td>
                  <td>{referral.description}</td>
                  <td>{referral.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : (
        <Notice>Nothing referred. This submission is clear to bind.</Notice>
      )}

      {quote.rating ? (
        <div className="table-wrap">
          <table className="data">
            <caption>Premium by coverage</caption>
            <thead>
              <tr>
                <th scope="col">Coverage</th>
                <th scope="col">Vehicle</th>
                <th scope="col" className="num">
                  Annual premium
                </th>
              </tr>
            </thead>
            <tbody>
              {quote.rating.lines.map((line, index) => {
                const vehicle = form.vehicles.find((v) => v.id === line.vehicleId);
                return (
                  <tr key={`${line.coverageCode}-${index}`}>
                    <td>
                      <span className="cell-title">{line.coverageName}</span>
                      <span className="cell-sub mono">{line.coverageCode}</span>
                    </td>
                    <td>{vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : '—'}</td>
                    <td className="num">
                      <Money cents={line.annualPremiumCents} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="btn-row">
        <Button variant="primary" onClick={onOpenJob}>
          {referred ? 'Send to underwriting' : 'Continue to bind'}
        </Button>
      </div>
    </div>
  );
}
