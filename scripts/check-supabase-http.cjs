const { execFileSync } = require('node:child_process');

// PostgREST <14.15 silently closed HEAD connections, letting Kong reuse a
// dead socket for the next POST/PATCH. Check the actual HTTP behavior before
// testing, including when a developer's .temp/rest-version overrides the CLI.
// https://github.com/supabase/cli/issues/6674
function checkSupabaseHttp(projectId) {
  execFileSync(
    'docker',
    [
      'exec',
      `supabase_kong_${projectId}`,
      'resty',
      '-e',
      String.raw`
    local socket = ngx.socket.tcp()
    socket:settimeout(5000)
    assert(socket:connect("rest", 3000))
    assert(socket:send("HEAD / HTTP/1.1\r\nHost: rest\r\nConnection: keep-alive\r\n\r\n"))
    local status = assert(socket:receive())
    assert(status:match("^HTTP/1%.[01] 200 "), "PostgREST HEAD probe failed")
    local close = false
    while true do
      local line = assert(socket:receive())
      if line == "" then break end
      if line:lower():match("^connection:.*close") then close = true end
    end
    if not close then
      socket:settimeout(250)
      local _, err = socket:receive(1)
      assert(err == "timeout", "PostgREST silently closed HEAD: upgrade Supabase CLI and remove old .temp/rest-version overrides")
    end
    socket:close()
    print("PostgREST HEAD connection safety check passed")
  `,
    ],
    { stdio: 'inherit', timeout: 15_000 },
  );
}

module.exports = { checkSupabaseHttp };
