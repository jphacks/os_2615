export async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw Object.assign(
      new Error(
        options.method === "POST" && path === "/messages/reply"
          ? "送信結果を確認できません。送信先を確認してから再送してください。"
          : "接続できません。Backendの起動状態を確認してください。",
      ),
      {
        code:
          options.method === "POST" && path === "/messages/reply"
            ? "DELIVERY_UNKNOWN"
            : "NETWORK_ERROR",
      },
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw Object.assign(
      new Error(
        path === "/messages/reply"
          ? "送信結果を確認できません。送信先を確認してください。"
          : "APIから正しいJSONが返されませんでした。",
      ),
      {
        code:
          path === "/messages/reply" ? "DELIVERY_UNKNOWN" : "INVALID_RESPONSE",
      },
    );
  }
  if (!response.ok)
    throw Object.assign(
      new Error(result?.error?.message || "操作に失敗しました。"),
      { code: result?.error?.code },
    );
  if (!result || !Object.hasOwn(result, "data"))
    throw Object.assign(
      new Error(
        path === "/messages/reply"
          ? "送信結果を確認できません。送信先を確認してください。"
          : "APIレスポンスの形式を確認してください。",
      ),
      {
        code:
          path === "/messages/reply" ? "DELIVERY_UNKNOWN" : "INVALID_RESPONSE",
      },
    );
  return result;
}
