import { useState } from 'react';
import { request, useMutation } from '../lib/api.ts';
import { useRouter } from '../lib/router.tsx';
import type { Account } from '../lib/types.ts';
import { Button, Field, Notice, PageHead, Select, TextInput } from '../components/ui.tsx';

const PROVINCES = ['ON', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'PE', 'QC', 'SK', 'YT'];

interface Form {
  accountType: 'person' | 'organization';
  name: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
  producerCode: string;
}

const EMPTY: Form = {
  accountType: 'person',
  name: '',
  email: '',
  phone: '',
  addressLine1: '',
  city: '',
  province: 'ON',
  postalCode: '',
  producerCode: '',
};

export function NewAccount() {
  const { navigate } = useRouter();
  const [form, setForm] = useState<Form>(EMPTY);

  const create = useMutation<Form, { account: Account }>((body) =>
    request<{ account: Account }>('/accounts', { method: 'POST', body }),
  );

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const canSubmit =
    form.name.trim() !== '' &&
    form.addressLine1.trim() !== '' &&
    form.city.trim() !== '' &&
    form.postalCode.trim() !== '';

  async function submit() {
    const result = await create.run(form);
    if (result) navigate(`/accounts/${result.account.id}`);
  }

  return (
    <>
      <PageHead
        eyebrow="Accounts"
        title="New account"
        meta={
          <span>The customer of record. Policies and billing hang off it, so it comes first.</span>
        }
      />

      <section className="section">
        <form
          className="stack"
          style={{ maxWidth: '56rem', gap: 'var(--s-6)' }}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {create.error ? <Notice tone="error">{create.error.message}</Notice> : null}

          <div className="form-grid">
            <Field label="Account type">
              {(props) => (
                <Select
                  {...props}
                  value={form.accountType}
                  onChange={(event) => set('accountType', event.target.value as Form['accountType'])}
                >
                  <option value="person">Person</option>
                  <option value="organization">Organization</option>
                </Select>
              )}
            </Field>

            <Field
              label={form.accountType === 'person' ? 'Full name' : 'Legal name'}
              hint="As it should appear on the policy."
            >
              {(props) => (
                <TextInput
                  {...props}
                  value={form.name}
                  required
                  onChange={(event) => set('name', event.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="form-grid">
            <Field label="Email">
              {(props) => (
                <TextInput
                  {...props}
                  type="email"
                  value={form.email}
                  onChange={(event) => set('email', event.target.value)}
                />
              )}
            </Field>
            <Field label="Phone">
              {(props) => (
                <TextInput
                  {...props}
                  type="tel"
                  value={form.phone}
                  onChange={(event) => set('phone', event.target.value)}
                />
              )}
            </Field>
            <Field label="Producer code" hint="Broker or agency of record.">
              {(props) => (
                <TextInput
                  {...props}
                  value={form.producerCode}
                  placeholder="BRK-2201"
                  onChange={(event) => set('producerCode', event.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="form-grid">
            <Field label="Street address">
              {(props) => (
                <TextInput
                  {...props}
                  value={form.addressLine1}
                  required
                  onChange={(event) => set('addressLine1', event.target.value)}
                />
              )}
            </Field>
            <Field label="City">
              {(props) => (
                <TextInput
                  {...props}
                  value={form.city}
                  required
                  onChange={(event) => set('city', event.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="form-grid form-grid--narrow">
            <Field label="Province">
              {(props) => (
                <Select
                  {...props}
                  value={form.province}
                  onChange={(event) => set('province', event.target.value)}
                >
                  {PROVINCES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Postal code" hint="Drives the rating territory.">
              {(props) => (
                <TextInput
                  {...props}
                  value={form.postalCode}
                  required
                  placeholder="K1M 2A1"
                  onChange={(event) => set('postalCode', event.target.value.toUpperCase())}
                />
              )}
            </Field>
          </div>

          <div className="btn-row">
            <Button type="submit" variant="primary" loading={create.pending} disabled={!canSubmit}>
              Create account
            </Button>
            <Button variant="ghost" onClick={() => navigate('/accounts')}>
              Cancel
            </Button>
          </div>
        </form>
      </section>
    </>
  );
}
