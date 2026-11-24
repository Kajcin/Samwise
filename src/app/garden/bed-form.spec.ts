import { msg } from '../core/i18n/i18n';
import { MAX_BED_SIZE, validateBedForm } from './bed-form';

describe('validateBedForm', () => {
  it('rejects an empty name', () => {
    expect(validateBedForm('  ', 3, 3)).toEqual(msg('bedEditor.errors.nameRequired'));
  });

  it('rejects missing or non-positive dimensions', () => {
    expect(validateBedForm('Bed 1', 0, 3)).toEqual(msg('bedEditor.errors.sizeAtLeastOne'));
    expect(validateBedForm('Bed 1', 3, -1)).toEqual(msg('bedEditor.errors.sizeAtLeastOne'));
    expect(validateBedForm('Bed 1', null, 3)).toEqual(msg('bedEditor.errors.sizeAtLeastOne'));
  });

  it('rejects fractional dimensions', () => {
    expect(validateBedForm('Bed 1', 2.5, 3)).toEqual(msg('bedEditor.errors.sizeWhole'));
  });

  it(`rejects dimensions above ${MAX_BED_SIZE}`, () => {
    expect(validateBedForm('Bed 1', MAX_BED_SIZE + 1, 3)).toEqual(msg('bedEditor.errors.sizeAtMost', { max: MAX_BED_SIZE }));
  });

  it('accepts a valid form', () => {
    expect(validateBedForm('Bed 1', 3, 4)).toBeNull();
    expect(validateBedForm('Bed 1', 1, MAX_BED_SIZE)).toBeNull();
  });
});
