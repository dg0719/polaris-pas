import { useMemo, useState } from 'react';
import { request, useMutation, useQuery } from '../lib/api.ts';
import { claimantKindLabel, date, money, todayIso, transactionLabel } from '../lib/format.ts';
import { Link, useRouter } from '../lib/router.tsx';
import type {
  Claim,
  ClaimantKind,
  CoverageAtDate,
  Policy,
  PolicySummary,
} from '../lib/types.ts';
import {
  Button,
  Fact,
  Facts,
  Field,
  Notice,
  PageHead,
  Section,
  Select,
  Status,
  TextInput,
} from '../components/ui.tsx';

const STEPS = ['Loss details', 'Coverage', 'Exposures', 'Review'] as const;

interface ExposureChoice {
  coverageCode: string;
  riskItemId?: string;
  label: string;
  selected: boolean;
  claimantName: string;
  claimantKind: ClaimantKind;
}

/**
 * First notice of loss. The coverage step is the point: the system verifies
 * what was in force on the loss date before anything else happens.
 */
export function Fnol({ policyId }: { policyId: string }) {
  const { navigate } = useRouter();
  const policy = useQuery<{ policy: Policy & PolicySummary; account: { name: string; id: string } }>(
    `/policies/${policyId}`,
  );

  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [lossDate, setLossDate] = useState(todayIso());
  const [reportedDate] = useState(todayIso());
  const [lossCause, setLossCause] = useState('');
  const [description, setDescription] = useState('');
  const [lossLocation, setLossLocation] = useState('');
  const [exposures, setExposures] = useState<ExposureChoice[]>([]);

  // Coverage is verified the moment the wizard reaches the coverage step.
  const [checkedDate, setCheckedDate] = useState<string | null>(null);
  const coverage = useQuery<CoverageAtDate>(
    checkedDate ? `/policies/${policyId}/coverage-at?date=${checkedDate}` : null,
  );

  const cause = coverage.data?.lossCauses.find((c) => c.code === lossCause);
  const accountName = policy.data?.account?.name ?? 'Insured';

  // The coverages on the verified version that respond to the chosen cause.
  const responding = useMemo<ExposureChoice[]>(() => {
    if (!coverage.data?.version || !cause) return [];
    return coverage.data.version.risk.coverages
      .filter((c) => cause.coverageCodes.includes(c.coverageCode))
      .map((c) => {
        const vehicle = coverage.data!.version!.risk.vehicles.find((v) => v.id === c.vehicleId);
        return {
          coverageCode: c.coverageCode,
          riskItemId: c.vehicleId,
          label: `${c.coverageCode}${vehicle ? ` — ${vehicle.year} ${vehicle.make} ${vehicle.model}` : ''}${
            c.deductibleCents ? ` (deductible ${money(c.deductibleCents)})` : ''
          }`,
          selected: true,
          claimantName: accountName,
          claimantKind: 'insured' as ClaimantKind,
        };
      });
  }, [coverage.data, cause, accountName]);

  const submit = useMutation<void, { claim: Claim }>(() =>
    request<{ claim: Claim }>('/claims', {
      method: 'POST',
      body: {
        policyId,
        lossDate,
        reportedDate,
        lossCause,
        description,
        lossLocation: lossLocation.trim() === '' ? undefined : lossLocation,
        exposures: exposures
          .filter((e) => e.selected)
          .map((e) => ({
            coverageCode: e.coverageCode,
            riskItemId: e.riskItemId,
            claimantName: e.claimantName,
            claimantKind: e.claimantKind,
          })),
      },
    }),
  );

  const inForce = coverage.data?.inForce === true;
  const stepValid =
    step === 0
      ? lossDate !== '' && description.trim() !== ''
      : step === 1
        ? inForce && lossCause !== ''
        : step === 2
          ? exposures.some((e) => e.selected)
          : true;

  function next() {
    if (!stepValid) return;
    if (step === 0) setCheckedDate(lossDate);
    if (step === 1) setExposures(responding);
    const target = Math.min(step + 1, STEPS.length - 1);
    setStep(target);
    setReached((r) => Math.max(r, target));
  }

  async function finish() {
    const result = await submit.run();
    if (result) navigate(`/claims/${result.claim.id}`);
  }

  return (
    <>
      <PageHead
        eyebrow={
          policy.data ? (
            <Link to={`/policies/${policyId}`} className="link mono">
              {policy.data.policy.policyNumber}
            </Link>
          ) : null
        }
        title="Report a claim"
        meta={
          <>
            <span>{accountName}</span>
            <span>Loss {date(lossDate)}</span>
          </>
        }
      />

      <nav className="steps" aria-label="Claim steps">
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
          </button>
        ))}
      </nav>

      <div className="step-panel" key={step}>
        {submit.error ? <Notice tone="error">{submit.error.message}</Notice> : null}

        {step === 0 ? (
          <Section
            title="What happened"
            note="The loss date decides which version of the policy answers, so it comes first."
          >
            <div className="form-grid">
              <Field label="Date of loss" hint="When it happened, not when it was reported.">
                {(props) => (
                  <TextInput
                    {...props}
                    type="date"
                    value={lossDate}
                    max={todayIso()}
                    onChange={(e) => setLossDate(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Where" hint="Optional. Intersection, city, or address.">
                {(props) => (
                  <TextInput
                    {...props}
                    value={lossLocation}
                    onChange={(e) => setLossLocation(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="What happened" hint="In the insured's words; detail helps the adjuster.">
              {(props) => (
                <TextInput
                  {...props}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              )}
            </Field>
          </Section>
        ) : null}

        {step === 1 ? (
          <Section
            title="Coverage on the loss date"
            note="Verified against the policy version in force when the loss happened."
          >
            {coverage.loading ? <p>Checking coverage…</p> : null}
            {coverage.data && !coverage.data.inForce ? (
              <Notice tone="error">{coverage.data.reason}</Notice>
            ) : null}
            {coverage.data?.inForce && coverage.data.version ? (
              <>
                <Facts>
                  <Fact label="Coverage">
                    <Status value="InForce" label="In force" />
                  </Fact>
                  <Fact label="Version">
                    {coverage.data.version.versionNumber} (
                    {transactionLabel(coverage.data.version.transactionType)})
                  </Fact>
                  <Fact label="Term">
                    {date(coverage.data.version.termStart)} →{' '}
                    {date(coverage.data.version.termEnd)}
                  </Fact>
                </Facts>
                <div style={{ marginTop: 'var(--s-6)', maxWidth: '28rem' }}>
                  <Field
                    label="Cause of loss"
                    hint="Decides which coverages can respond to the claim."
                  >
                    {(props) => (
                      <Select
                        {...props}
                        value={lossCause}
                        onChange={(e) => setLossCause(e.target.value)}
                      >
                        <option value="">Choose…</option>
                        {coverage.data!.lossCauses.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
                {cause && responding.length === 0 ? (
                  <Notice tone="error">
                    No coverage on this policy responds to {cause.name.toLowerCase()}. The claim
                    cannot proceed under this cause.
                  </Notice>
                ) : null}
              </>
            ) : null}
          </Section>
        ) : null}

        {step === 2 ? (
          <Section
            title="Exposures"
            note="One per coverage per claimant. Untick anything that is not being claimed."
          >
            {exposures.map((exposure, index) => (
              <div key={index} className="form-grid" style={{ marginBottom: 'var(--s-4)' }}>
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={exposure.selected}
                    onChange={(e) =>
                      setExposures((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, selected: e.target.checked } : item,
                        ),
                      )
                    }
                  />
                  <span>
                    <span className="choice__title">{exposure.label}</span>
                  </span>
                </label>
                {exposure.selected ? (
                  <>
                    <Field label="Claimant">
                      {(props) => (
                        <TextInput
                          {...props}
                          value={exposure.claimantName}
                          onChange={(e) =>
                            setExposures((current) =>
                              current.map((item, i) =>
                                i === index ? { ...item, claimantName: e.target.value } : item,
                              ),
                            )
                          }
                        />
                      )}
                    </Field>
                    {cause && cause.claimantKinds.length > 1 ? (
                      <Field label="Claimant type">
                        {(props) => (
                          <Select
                            {...props}
                            value={exposure.claimantKind}
                            onChange={(e) =>
                              setExposures((current) =>
                                current.map((item, i) =>
                                  i === index
                                    ? { ...item, claimantKind: e.target.value as ClaimantKind }
                                    : item,
                                ),
                              )
                            }
                          >
                            {cause.claimantKinds.map((kind) => (
                              <option key={kind} value={kind}>
                                {claimantKindLabel(kind)}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    ) : null}
                  </>
                ) : null}
              </div>
            ))}
          </Section>
        ) : null}

        {step === 3 ? (
          <Section title="Review" note="What will be opened when this claim is reported.">
            <Facts>
              <Fact label="Policy">
                <span className="mono">{policy.data?.policy.policyNumber}</span>
              </Fact>
              <Fact label="Loss date">{date(lossDate)}</Fact>
              <Fact label="Cause">{cause?.name ?? lossCause}</Fact>
              <Fact label="Exposures">
                {exposures.filter((e) => e.selected).length} to open
              </Fact>
            </Facts>
            <ul style={{ marginTop: 'var(--s-4)', paddingLeft: 'var(--s-6)' }}>
              {exposures
                .filter((e) => e.selected)
                .map((e, i) => (
                  <li key={i}>
                    {e.label} — {e.claimantName} ({claimantKindLabel(e.claimantKind)})
                  </li>
                ))}
            </ul>
          </Section>
        ) : null}

        <div className="wizard-foot">
          <Button variant="ghost" onClick={() => navigate(`/policies/${policyId}`)}>
            Cancel
          </Button>
          <div className="btn-row">
            {step > 0 ? (
              <Button variant="secondary" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            ) : null}
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={next} disabled={!stepValid}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void finish()} loading={submit.pending}>
                Report claim
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
