import {registerFormula} from './../../formulaRegisterer';
import moment from 'moment';

export const FORMULA_NAME = 'age_lt';

function formula(dataRow, [value] = inputValues) {
  let date = moment(dataRow.value, dataRow.meta.dateFormat);
  let inputDate = moment().subtract(value, 'years');

  if (!date.isValid() || !inputDate.isValid()) {
    return false;
  }

  return date.diff(inputDate) >= 0;
}

registerFormula(FORMULA_NAME, formula, {
  name: 'Umur kurang dari',
  inputsCount: 1
});
