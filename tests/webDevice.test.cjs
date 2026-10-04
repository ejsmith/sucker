const assert = require('node:assert/strict');
const test = require('node:test');
const { isMobileWebDevice } = require('../.build/src/ui/webDevice');

test('mobile sizing recognizes iPad desktop identity without treating touch laptops as phones', () => {
  for (const userAgent of ['Android', 'iPhone', 'iPad', 'iPod']) {
    assert.equal(isMobileWebDevice({ userAgent, maxTouchPoints: 0 }), true, userAgent);
  }
  assert.equal(isMobileWebDevice({ userAgent: 'Macintosh', maxTouchPoints: 5 }), true);
  assert.equal(isMobileWebDevice({ userAgent: 'Macintosh', maxTouchPoints: 0 }), false);
  assert.equal(isMobileWebDevice({ userAgent: 'Windows NT', maxTouchPoints: 10 }), false);
  assert.equal(isMobileWebDevice(undefined), false);
});
