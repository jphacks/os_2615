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
