const base = 'http://localhost:3000/api';

async function run() {
  const loginRes = await fetch(base + '/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'rudraksha@admin2026' })
  });
  const loginText = await loginRes.text();
  console.log('LOGIN_STATUS=' + loginRes.status);
  console.log(loginText);
  const login = JSON.parse(loginText);
  const token = login.token;

  const listBeforeRes = await fetch(base + '/rider-applications', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('LIST_BEFORE_STATUS=' + listBeforeRes.status);
  console.log(await listBeforeRes.text());

  const createRes = await fetch(base + '/rider-applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Shared Device Rider Verify',
      phone: '9988776666',
      city: 'Jaipur',
      shift: 'Full Time',
      vehType: 'Bike / Scooter',
      vehNum: 'RJ14 XX 6666',
      dlNum: 'RJ14 2022006666'
    })
  });
  const createText = await createRes.text();
  console.log('CREATE_STATUS=' + createRes.status);
  console.log(createText);

  const created = JSON.parse(createText);
  const appId = created && created.application && created.application.id;

  const listAfterRes = await fetch(base + '/rider-applications', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('LIST_AFTER_STATUS=' + listAfterRes.status);
  console.log(await listAfterRes.text());

  if (appId) {
    const approveRes = await fetch(base + '/rider-applications/' + appId + '/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pin: '9876' })
    });
    console.log('APPROVE_STATUS=' + approveRes.status);
    console.log(await approveRes.text());
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
