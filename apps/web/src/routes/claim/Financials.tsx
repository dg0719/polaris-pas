import type { ClaimFinancials } from '../../lib/types.ts';
import { Fact, Facts, Money } from '../../components/ui.tsx';

/** The numbers an adjuster reads first, in the order they ask for them. */
export function FinancialsSummary({ financials }: { financials: ClaimFinancials }) {
  return (
    <Facts>
      <Fact label="Incurred" lead>
        <Money cents={financials.incurredCents} />
      </Fact>
      <Fact label="Reserve outstanding">
        <Money cents={financials.outstandingCents} />
      </Fact>
      <Fact label="Paid">
        <Money cents={financials.paidCents} />
      </Fact>
      <Fact label="Pending payments">
        <Money cents={financials.pendingCents} />
      </Fact>
      <Fact label="Recovered">
        <Money cents={financials.recoveredCents} />
      </Fact>
      <Fact label="Net incurred">
        <Money cents={financials.netIncurredCents} />
      </Fact>
    </Facts>
  );
}
