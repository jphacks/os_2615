/*
APIで公開可能なエラーを定義する。内部エラーの内容は返さない。
*/
export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const storageError = () => new AppError(500, 'STORAGE_ERROR', 'データの読み書きに失敗しました。');
export const notFound = () => new AppError(404, 'NOT_FOUND', '対象が見つかりません。');
export const invalidInput = () => new AppError(400, 'VALIDATION_ERROR', '入力内容を確認してください。');
export const deliveryUnknown = (status = 502) => new AppError(status, 'DELIVERY_UNKNOWN',
  '送信結果を確認できません。送信先を確認してから再送してください。');
export const providerError = () => new AppError(502, 'PROVIDER_ERROR', '外部サービスへの送信に失敗しました。');
