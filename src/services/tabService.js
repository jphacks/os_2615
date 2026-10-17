/* タブ作成の入力を検証する。所属変更はContactの内部IDを使う。 */
import { invalidInput } from '../utils/errors.js';
export function createTabService(repository) {
  return {
    list: repository.list,
    create(input) {
      if (!input || Array.isArray(input) || typeof input !== 'object' ||
          Object.keys(input).length !== 1 || typeof input.name !== 'string' ||
          !input.name.trim() || input.name.trim().length > 40) throw invalidInput();
      return repository.create(input.name.trim());
    },
    reorder(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 ||
          !['tabIds', 'expectedOrder'].every(key => Array.isArray(input[key]) &&
            input[key].every(id => typeof id === 'string' && id) && new Set(input[key]).size === input[key].length) ||
          input.tabIds.length !== input.expectedOrder.length) throw invalidInput();
      return repository.reorder(input.tabIds, input.expectedOrder);
    },
    move(id, input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).length !== 1 || !['previous', 'next', 'first', 'last'].includes(input.direction)) throw invalidInput();
      return repository.move(id, input.direction);
    },
    remove: repository.remove,
    setMember: repository.setMember
  };
}
