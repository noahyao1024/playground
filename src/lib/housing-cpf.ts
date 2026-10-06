/** Monthly OA interest, accumulated without earning interest until the
 * December year-end credit. New deposits earn from the following month;
 * withdrawals stop earning in the month withdrawn. These are modelled monthly
 * transactions, not an imported CPF statement. Extra interest is excluded.
 * https://www.cpf.gov.sg/member/infohub/reports-and-statistics/cpf-statistics/interest-statistics */
export class CpfOaLedger {
  balance: number;
  pending = 0;
  constructor(opening: number) { this.balance = opening; }
  get total() { return this.balance + this.pending; }
  month(contribution: number, requestedWithdrawal: number, annualPercent: number, calendarMonth: number) {
    const opening = this.balance;
    const withdrawn = Math.max(0, Math.min(opening + contribution, requestedWithdrawal));
    this.balance += contribution - withdrawn;
    this.pending += Math.max(0, opening - withdrawn) * annualPercent / 1200;
    if (calendarMonth === 12) {
      this.balance += Math.round(this.pending * 100) / 100;
      this.pending = 0;
    }
    return withdrawn;
  }
}

/** Housing withdrawals accrue the interest they would have earned in OA.
 * Unlike OA deposits, the principal withdrawn loses interest in that month.
 * Monthly accrual is carried separately; only the year-end credit compounds. */
export class CpfHousingLedger {
  principal: number;
  private creditedInterest = 0;
  private pending = 0;
  constructor(openingWithdrawal: number) { this.principal = openingWithdrawal; }
  get refund() { return this.principal + this.creditedInterest + this.pending; }
  get interest() { return this.creditedInterest + this.pending; }
  month(withdrawn: number, annualPercent: number, calendarMonth: number) {
    this.principal += withdrawn;
    this.pending += (this.principal + this.creditedInterest) * annualPercent / 1200;
    if (calendarMonth === 12) {
      this.creditedInterest += Math.round(this.pending * 100) / 100;
      this.pending = 0;
    }
  }
}
