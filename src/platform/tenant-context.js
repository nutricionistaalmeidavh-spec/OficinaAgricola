'use strict';

/** Fail-closed tenant and unit scope. Never accept a tenant identifier from an
 * untrusted request without comparing it against authenticated memberships. */
function requireTenantContext(identity, requestedCompanyId, requestedUnitId) {
  if (!identity || !Array.isArray(identity.memberships)) {
    throw Object.assign(new Error('Authentication required'), { status: 401 });
  }
  const companyId = String(requestedCompanyId || '').trim();
  if (!companyId) throw Object.assign(new Error('Company context required'), { status: 400 });
  const membership = identity.memberships.find(m => String(m.companyId) === companyId && m.active === true);
  if (!membership) throw Object.assign(new Error('Company access denied'), { status: 403 });
  const unitId = requestedUnitId == null ? null : String(requestedUnitId).trim();
  if (unitId !== null && (!unitId || !(membership.allUnits === true || (membership.unitIds || []).some(id => String(id) === unitId)))) {
    throw Object.assign(new Error('Unit access denied'), { status: 403 });
  }
  return Object.freeze({ companyId, unitId, role: membership.role });
}

function scopedWhere(context, alias = '') {
  if (!context || !context.companyId) throw new Error('Tenant context required');
  if (alias && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error('Invalid SQL alias');
  const prefix = alias ? alias + '.' : '';
  return Object.freeze({
    clause: prefix + 'company_id = ?' + (context.unitId ? ' AND ' + prefix + 'unit_id = ?' : ''),
    params: context.unitId ? [context.companyId, context.unitId] : [context.companyId]
  });
}
module.exports = { requireTenantContext, scopedWhere };
