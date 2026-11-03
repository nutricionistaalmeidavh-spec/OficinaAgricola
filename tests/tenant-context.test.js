import test from 'node:test';
import assert from 'node:assert/strict';
import { requireTenantContext, scopedWhere } from '../src/platform/tenant-context.js';
const user = { memberships: [{ companyId: 'a', active: true, role: 'manager', unitIds: ['u1'] }, { companyId: 'b', active: false, role: 'admin', allUnits: true }] };
test('rejects unauthenticated, missing, foreign and inactive company contexts', () => {
  assert.throws(() => requireTenantContext(null, 'a'), { status: 401 });
  assert.throws(() => requireTenantContext(user, ''), { status: 400 });
  assert.throws(() => requireTenantContext(user, 'b'), { status: 403 });
  assert.throws(() => requireTenantContext(user, 'c'), { status: 403 });
});
test('enforces unit memberships and immutable scope', () => {
  assert.throws(() => requireTenantContext(user, 'a', 'u2'), { status: 403 });
  const scope = requireTenantContext(user, 'a', 'u1');
  assert.equal(Object.isFrozen(scope), true);
  assert.deepEqual(scopedWhere(scope, 'os'), { clause: 'os.company_id = ? AND os.unit_id = ?', params: ['a', 'u1'] });
});
test('rejects SQL alias injection', () => {
  assert.throws(() => scopedWhere(requireTenantContext(user, 'a'), 'x;DROP TABLE'), /Invalid SQL alias/);
});
