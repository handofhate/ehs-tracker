(function attachTracker2Financial(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./debt-feature'), require('./fee-domain'));
  } else {
    root.Tracker2Financial = factory(root.Tracker2DebtFeature, root.Tracker2Fees);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createFinancialDomain(debtFeature, feeDomain) {
  'use strict';

  function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function calcSplit(gross, { empShare, feeRate, txnFee = 0, txnCount = 0 } = {}) {
    const normalizedGross = roundMoney(gross);
    const totalFees = roundMoney(normalizedGross * feeRate + txnFee * txnCount);
    const netRevenue = roundMoney(normalizedGross - totalFees);
    const empOwed = roundMoney(netRevenue * empShare);
    const ownerOwed = roundMoney(netRevenue * (1 - empShare));
    return { totalFees, netRevenue, empOwed, ownerOwed };
  }

  function jobType(job) {
    return job?.jobType === 'hourly' || job?.jobType === 'hourly2' ? 'hourly' : 'quoted';
  }

  function jobWorkCompleted(job) {
    return job?.workCompleted !== false;
  }

  function isCollectedBillingItem(item, status = null) {
    const itemStatus = status ?? item?.status;
    return itemStatus === 'collected' || itemStatus === 'paid' || item?.billingState === 'paid';
  }

  function milestoneBasis(job) {
    return job?.milestoneBasis === 'amount' ? 'amount' : 'percent';
  }

  function milestoneAmount(job, milestone) {
    if (milestoneBasis(job) === 'amount' && milestone?.amount !== undefined) {
      return roundMoney(Number(milestone.amount || 0));
    }
    return roundMoney((Number(milestone?.pct || 0) / 100) * Number(job?.quote || 0));
  }

  function milestonePercent(job, milestone) {
    if (milestoneBasis(job) === 'percent') return Number(milestone?.pct || 0);
    const quote = Number(job?.quote || 0);
    return quote > 0 ? (Number(milestone?.amount || 0) / quote) * 100 : 0;
  }

  function calcJob(job, { employee = null, settings = {}, debtPayments = [] } = {}) {
    const empShare = employee?.empShare ?? 0.66;
    const { feeRate, txnFee } = feeDomain.forJob(job, settings);
    const normalOwnerShare = 1 - empShare;
    const effectiveOwnerShare = debtFeature.effectiveOwnerShare(job, employee, settings);
    const effectiveEmpShare = 1 - effectiveOwnerShare;
    const type = jobType(job);
    const isLegacyHourly = false;
    const isHourly = type === 'hourly';
    const revenueItems = isLegacyHourly ? (job.revenueItems || []) : [];
    const revenueTotal = revenueItems.reduce((sum, item) => sum + (item.amount || 0), 0);
    const hourlyRate = Number(job.hourlyRate || 0);
    const hoursTotal = (job.addOns || []).filter(item => !!item.isHours).reduce((sum, item) => sum + (item.amount || 0), 0);
    const loggedHoursTotal = (job.hours || []).reduce((sum, item) => sum + (item.hours || 0), 0);
    const loggedHoursAmount = roundMoney(loggedHoursTotal * hourlyRate);
    const materialChargeTotal = (job.materials || []).reduce((sum, item) => sum + Number(item.chargeAmount ?? item.amount ?? 0), 0);

    const addOnTotal = isHourly ? 0 : (job.addOns || []).reduce((sum, item) => sum + (item.amount || 0), 0);
    const subtractionTotal = isHourly ? 0 : (job.subtractions || []).reduce((sum, item) => sum + (item.amount || 0), 0);
    const contractTotal = isHourly
      ? roundMoney(loggedHoursAmount + hoursTotal + materialChargeTotal)
      : (isLegacyHourly ? revenueTotal : (job.quote || 0)) + addOnTotal - subtractionTotal;

    let collectedGross = 0;
    let estimatedFees = 0;
    let collectedTxns = 0;
    if (isHourly) {
      if (isCollectedBillingItem(job, job.hourlyStatus || 'pending')) {
        collectedGross += contractTotal;
        estimatedFees += contractTotal * feeRate;
        collectedTxns++;
      }
    } else if (isLegacyHourly) {
      revenueItems.forEach(item => {
        if (isCollectedBillingItem(item, item.status || 'pending')) {
          const gross = Number(item.amount || 0);
          collectedGross += gross;
          estimatedFees += gross * feeRate;
          collectedTxns++;
        }
      });
    } else {
      (job.milestones || []).forEach(item => {
        if (isCollectedBillingItem(item)) {
          const gross = milestoneAmount(job, item);
          collectedGross += gross;
          estimatedFees += gross * feeRate;
          collectedTxns++;
        }
      });
    }
    if (!isHourly) {
      (job.addOns || []).forEach(item => {
        if (isCollectedBillingItem(item)) {
          collectedGross += item.amount || 0;
          estimatedFees += (item.amount || 0) * feeRate;
          collectedTxns++;
        }
      });
      (job.subtractions || []).forEach(item => {
        if (isCollectedBillingItem(item)) {
          collectedGross -= item.amount || 0;
          estimatedFees -= (item.amount || 0) * feeRate;
        }
      });
    }
    estimatedFees += txnFee * collectedTxns;
    const manualFees = (job.fees || []).reduce((sum, fee) => sum + (fee.amount || 0), 0);
    const totalFees = estimatedFees + manualFees;
    const netRevenue = collectedGross - totalFees;

    let pendingGross = 0;
    let pendingTxns = 0;
    if (isHourly) {
      if (!isCollectedBillingItem(job, job.hourlyStatus || 'pending')) {
        pendingGross += contractTotal;
        pendingTxns++;
      }
    } else if (isLegacyHourly) {
      revenueItems.forEach(item => {
        if (isCollectedBillingItem(item, item.status || 'pending')) return;
        pendingGross += Number(item.amount || 0);
        pendingTxns++;
      });
    } else {
      (job.milestones || []).forEach(item => { if (!isCollectedBillingItem(item)) pendingGross += milestoneAmount(job, item); });
      (job.milestones || []).forEach(item => { if (!isCollectedBillingItem(item)) pendingTxns++; });
    }
    if (!isHourly) {
      (job.addOns || []).forEach(item => { if (!isCollectedBillingItem(item)) { pendingGross += item.amount || 0; pendingTxns++; } });
      (job.subtractions || []).forEach(item => { if (!isCollectedBillingItem(item)) pendingGross -= item.amount || 0; });
    }

    const ownerMats = (job.materials || []).filter(item => item.who === 'owner').reduce((sum, item) => sum + Number(item.costAmount ?? item.amount ?? 0), 0);
    const empMats = (job.materials || []).filter(item => item.who === 'emp').reduce((sum, item) => sum + Number(item.costAmount ?? item.amount ?? 0), 0);
    const totalMats = ownerMats + empMats;
    const profitPool = Math.max(0, netRevenue - totalMats);
    const empProfit = profitPool * effectiveEmpShare;
    const ownerProfit = profitPool * effectiveOwnerShare;
    const debtContribution = debtFeature.debtContribution(job, profitPool, employee, settings);
    const tipsTotal = (job.tips || []).reduce((sum, tip) => sum + (tip.amount || 0), 0);
    const advancesPaid = (job.advances || []).reduce((sum, advance) => sum + (advance.amount || 0), 0);
    const workCompleted = jobWorkCompleted(job);
    const empTotalOwed = workCompleted ? empProfit + empMats + tipsTotal : 0;
    const linkedDebtPaid = (debtPayments || []).filter(payment => payment.linkedJobId === job.id).reduce((sum, payment) => sum + (payment.amount || 0), 0);
    const empBalance = (workCompleted ? empTotalOwed : 0) - advancesPaid - linkedDebtPaid;
    const outstanding = contractTotal - collectedGross;
    const projectedGross = collectedGross + pendingGross;
    const projectedTxns = collectedTxns + pendingTxns;
    const projectedFees = projectedGross * feeRate + txnFee * projectedTxns + manualFees;
    const projectedNetRevenue = projectedGross - projectedFees;
    const projectedProfitPool = Math.max(0, projectedNetRevenue - totalMats);
    const potentialEmpTotalOwed = workCompleted ? projectedProfitPool * effectiveEmpShare + empMats + tipsTotal : 0;
    const potentialEmpBalance = (workCompleted ? potentialEmpTotalOwed : 0) - advancesPaid - linkedDebtPaid;
    const potentialOwnerProfit = projectedProfitPool * effectiveOwnerShare;
    const potentialOwnerTotal = potentialOwnerProfit + ownerMats;
    const potentialDebtContribution = debtFeature.debtContribution(job, projectedProfitPool, employee, settings);
    const ownerTotal = ownerProfit + ownerMats;
    const totalHours = (job.hours || []).reduce((sum, item) => sum + (item.hours || 0), 0);

    return {
      contractTotal: roundMoney(contractTotal), addOnTotal: roundMoney(addOnTotal), subtractionTotal: roundMoney(subtractionTotal),
      collectedGross: roundMoney(collectedGross), pendingGross: roundMoney(pendingGross), workCompleted,
      totalFees: roundMoney(totalFees), netRevenue: roundMoney(netRevenue), totalMats: roundMoney(totalMats),
      ownerMats: roundMoney(ownerMats), empMats: roundMoney(empMats), profitPool: roundMoney(profitPool),
      empProfit: roundMoney(empProfit), ownerProfit: roundMoney(ownerProfit), debtContribution: roundMoney(debtContribution),
      tipsTotal: roundMoney(tipsTotal), empTotalOwed: roundMoney(empTotalOwed), advancesPaid: roundMoney(advancesPaid),
      linkedDebtPaid: roundMoney(linkedDebtPaid), empBalance: roundMoney(empBalance), outstanding: roundMoney(outstanding),
      projectedGross: roundMoney(projectedGross), projectedFees: roundMoney(projectedFees), projectedNetRevenue: roundMoney(projectedNetRevenue),
      projectedProfitPool: roundMoney(projectedProfitPool), potentialEmpTotalOwed: roundMoney(potentialEmpTotalOwed),
      potentialEmpBalance: roundMoney(potentialEmpBalance), potentialOwnerProfit: roundMoney(potentialOwnerProfit),
      potentialOwnerTotal: roundMoney(potentialOwnerTotal), potentialDebtContribution: roundMoney(potentialDebtContribution),
      ownerTotal: roundMoney(ownerTotal), totalHours
    };
  }

  function calcHomewatch(homewatch, { employee = null, settings = {}, debtPayments = [] } = {}) {
    const empShare = employee?.empShare ?? 0.66;
    const collectedPayments = (homewatch.payments || []).filter(payment => payment.status === 'collected');
    const collectedGross = collectedPayments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
    const pendingPayments = (homewatch.payments || []).filter(payment => payment.status !== 'collected');
    const pendingGross = pendingPayments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
    const paymentFees = payments => payments.reduce((sum, payment) => {
      const { feeRate, txnFee } = feeDomain.forPayment(payment, settings);
      return sum + Number(payment.amount || 0) * feeRate + txnFee;
    }, 0);
    const totalFees = roundMoney(paymentFees(collectedPayments));
    const netRevenue = roundMoney(collectedGross - totalFees);
    const empOwed = roundMoney(netRevenue * empShare);
    const ownerOwed = roundMoney(netRevenue * (1 - empShare));
    const advancesPaid = (homewatch.advances || []).reduce((sum, advance) => sum + (advance.amount || 0), 0);
    const linkedDebtPaid = (debtPayments || []).filter(payment => payment.linkedHWId === homewatch.id).reduce((sum, payment) => sum + (payment.amount || 0), 0);
    const empBalance = empOwed - advancesPaid - linkedDebtPaid;
    const projectedFees = roundMoney(paymentFees([...(collectedPayments || []), ...(pendingPayments || [])]));
    const projectedNetRevenue = roundMoney(collectedGross + pendingGross - projectedFees);
    const potentialEmpOwed = roundMoney(projectedNetRevenue * empShare);
    return {
      collectedGross: roundMoney(collectedGross), pendingGross: roundMoney(pendingGross), totalFees: roundMoney(totalFees),
      netRevenue: roundMoney(netRevenue), empOwed: roundMoney(empOwed), ownerOwed: roundMoney(ownerOwed),
      advancesPaid: roundMoney(advancesPaid), linkedDebtPaid: roundMoney(linkedDebtPaid), empBalance: roundMoney(empBalance),
      potentialEmpBalance: roundMoney(potentialEmpOwed - advancesPaid - linkedDebtPaid)
    };
  }

  return Object.freeze({
    calcHomewatch,
    calcJob,
    calcSplit,
    isCollectedBillingItem,
    jobType,
    jobWorkCompleted,
    milestoneAmount,
    milestoneBasis,
    milestonePercent,
    roundMoney
  });
});
