/** Every user-facing text. Pass a partial override, or a full locale such as `zhCN`. */
export interface Messages {
  /** BCP 47 locale for sorting and number display, e.g. `'en'`, `'zh-CN'`. */
  locale: string
  errors: {
    tableReadOnly: string
    cellReadOnly: string
    required: string
    rowNotFound: string
    unknownColumn: (field: string) => string
    notANumber: string
    atLeast: (min: number) => string
    atMost: (max: number) => string
    notYesNo: string
    dateFormat: string
    invalidDate: string
    notAnOption: (text: string) => string
    invalidRegex: string
    chooseCase: string
    noSaveHandler: string
  }
  /** Labels of filter operators, by field type and operator name. */
  filters: {
    isEmpty: string
    isNotEmpty: string
    contains: string
    notContains: string
    is: string
    isNot: string
    startsWith: string
    eq: string
    ne: string
    gt: string
    gte: string
    lt: string
    lte: string
    checked: string
    unchecked: string
    before: string
    after: string
    isAnyOf: string
    hasAnyOf: string
    hasAllOf: string
    hasNoneOf: string
  }
  bulk: {
    set: string
    clear: string
    affix: string
    prefix: string
    suffix: string
    replace: string
    find: string
    replacement: string
    regex: string
    matchCase: string
    changeCase: string
    upper: string
    lower: string
    title: string
    increaseBy: string
    multiplyBy: string
    shiftDays: string
    addTags: string
    removeTags: string
  }
  quick: {
    changeCase: string
    trimSpaces: string
    plusOne: string
    minusOne: string
    round: string
    roundTo: (digits: number) => string
    setZero: string
    checkAll: string
    uncheckAll: string
    toggleEach: string
    today: string
    tomorrow: string
    shift: string
    plusDay: string
    minusDay: string
    plusWeek: string
    minusWeek: string
    plusMonth: string
    minusMonth: string
    setTo: string
    add: string
    remove: string
    removeAll: string
  }
  ui: {
    search: string
    filter: string
    sort: string
    addRow: string
    undo: string
    redo: string
    save: string
    saving: string
    saved: string
    saveFailed: (error: string) => string
    unsavedRows: (count: number) => string
    invalidCells: (count: number) => string
    conflicts: (count: number) => string
    readOnly: string
    editCells: (count: number) => string
    fixInvalid: (count: number) => string
    resolveConflicts: (count: number) => string
    rowsNotSaved: (count: number) => string
    changedCells: (count: number) => string
    skipped: (count: number) => string
    rows: (count: number) => string
    rowsOfTotal: (visible: number, total: number) => string
    cellsSelected: (count: number) => string
    cellCount: (count: number) => string
    options: string
    sum: string
    noRows: string
    noMatchingRows: string
    loading: string
    readOnlyCell: string
    copy: string
    paste: string
    pasteHint: (shortcut: string) => string
    clearCells: string
    insertAbove: string
    insertBelow: string
    duplicateRows: (count: number) => string
    deleteRows: (count: number) => string
    quickEdit: string
    cellsIn: (column: string, count: number) => string
    copiedLastRange: string
    keepMine: string
    useTheirs: (value: string) => string
    conflictTitle: (theirs: string) => string
    applyToAll: (shortcut: string, count: number) => string
    applyingToAll: (count: number) => string
    findOption: string
    openOptions: (column: string) => string
    removeOption: (label: string) => string
    originalValue: string
    createOption: (text: string) => string
    noMatchingOption: string
    multiSelectHint: string
    filterWhere: string
    filterAnd: string
    noFilters: string
    addCondition: string
    chooseOption: string
    value: string
    sortBy: string
    thenBy: string
    noSorting: string
    ascending: string
    descending: string
    addSort: string
    removeCondition: string
    sortAscending: string
    sortDescending: string
    /** Accessible name of a sorted column's sort button; `priority` is set when several columns sort. */
    sortState: (column: string, direction: 'asc' | 'desc', priority?: number) => string
    bulkTitle: (count: number) => string
    keepUnchanged: string
    chooseWhat: string
    fixInputs: string
    willChange: (count: number) => string
    alreadyMatch: (count: number) => string
    skippedReason: (count: number, reason: string) => string
    applyHint: (apply: string, undo: string) => string
    cancel: string
    apply: string
    changeCells: (count: number) => string
    emptyValue: string
    newValue: string
    checked: string
    unchecked: string
    dropToUpload: string
    uploadFailed: (error: string) => string
    notAccepted: (column: string) => string
  }
  image: {
    notImageUrl: string
    onlyOne: string
    atMost: (count: number) => string
    noImages: string
    chooseImage: string
    onlyMoreFit: (count: number) => string
    waitForUpload: string
    add: string
    replace: string
    remove: (index: number) => string
    uploading: string
    urlPlaceholder: string
    dropOrPaste: string
    done: string
    countAtLeast: string
  }
}

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`

export const en: Messages = {
  locale: 'en',
  errors: {
    tableReadOnly: 'The table is read-only',
    cellReadOnly: 'Read-only',
    required: 'Required',
    rowNotFound: 'Row not found',
    unknownColumn: field => `Unknown column "${field}"`,
    notANumber: 'Not a number',
    atLeast: min => `Must be at least ${min}`,
    atMost: max => `Must be at most ${max}`,
    notYesNo: 'Not a yes/no value',
    dateFormat: 'Use YYYY-MM-DD',
    invalidDate: 'Not a valid date',
    notAnOption: text => `"${text}" is not an option`,
    invalidRegex: 'Invalid regular expression',
    chooseCase: 'Choose upper, lower or title',
    noSaveHandler: 'No onSave handler.',
  },
  filters: {
    isEmpty: 'is empty', isNotEmpty: 'is not empty', contains: 'contains', notContains: 'does not contain', is: 'is',
    isNot: 'is not', startsWith: 'starts with', eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤',
    checked: 'is checked', unchecked: 'is not checked', before: 'is before', after: 'is after', isAnyOf: 'is any of',
    hasAnyOf: 'has any of', hasAllOf: 'has all of', hasNoneOf: 'has none of',
  },
  bulk: {
    set: 'Set to', clear: 'Clear', affix: 'Add prefix / suffix', prefix: 'Prefix', suffix: 'Suffix', replace: 'Find and replace',
    find: 'Find', replacement: 'Replace with', regex: 'Regular expression', matchCase: 'Match case', changeCase: 'Change case',
    upper: 'UPPERCASE', lower: 'lowercase', title: 'Title Case', increaseBy: 'Increase by', multiplyBy: 'Multiply by',
    shiftDays: 'Shift by days', addTags: 'Add', removeTags: 'Remove',
  },
  quick: {
    changeCase: 'Change case', trimSpaces: 'Trim spaces', plusOne: '+1', minusOne: '−1', round: 'Round',
    roundTo: digits => `Round to ${digits} decimals`, setZero: 'Set to 0', checkAll: 'Check all', uncheckAll: 'Uncheck all',
    toggleEach: 'Toggle each', today: 'Today', tomorrow: 'Tomorrow', shift: 'Shift', plusDay: '+1 day', minusDay: '−1 day',
    plusWeek: '+1 week', minusWeek: '−1 week', plusMonth: '+1 month', minusMonth: '−1 month', setTo: 'Set to', add: 'Add',
    remove: 'Remove', removeAll: 'Remove all',
  },
  ui: {
    search: 'Search', filter: 'Filter', sort: 'Sort', addRow: '+ Row', undo: 'Undo', redo: 'Redo', save: 'Save',
    saving: 'Saving…', saved: 'All changes saved', saveFailed: error => `Save failed: ${error}`,
    unsavedRows: count => `${plural(count, 'unsaved row')}`, invalidCells: count => plural(count, 'invalid cell'),
    conflicts: count => plural(count, 'conflict'), readOnly: 'Read-only',
    editCells: count => `Edit ${count.toLocaleString()} cells`,
    fixInvalid: count => `Fix ${plural(count, 'invalid cell')} before saving`,
    resolveConflicts: count => `Resolve ${plural(count, 'conflict')} before saving`,
    rowsNotSaved: count => `${count === 1 ? '1 row was' : `${count} rows were`} not saved`,
    changedCells: count => `Changed ${plural(count, 'cell')}`, skipped: count => `skipped ${count.toLocaleString()}`,
    rows: count => plural(count, 'row'), rowsOfTotal: (visible, total) => `${visible.toLocaleString()} of ${total.toLocaleString()} rows`,
    cellsSelected: count => `${count.toLocaleString()} cells selected`, cellCount: count => plural(count, 'cell'), options: 'Options', sum: 'Sum', noRows: 'No rows',
    noMatchingRows: 'No rows match the current filter', loading: 'Loading…', readOnlyCell: 'This cell is read-only',
    copy: 'Copy', paste: 'Paste', pasteHint: shortcut => `Use ${shortcut} to paste`, clearCells: 'Clear cells',
    insertAbove: 'Insert row above', insertBelow: 'Insert row below',
    duplicateRows: count => count > 1 ? `Duplicate ${count} rows` : 'Duplicate row',
    deleteRows: count => count > 1 ? `Delete ${count} rows` : 'Delete row', quickEdit: 'Quick edit',
    cellsIn: (column, count) => `${column} · ${plural(count, 'cell')}`,
    copiedLastRange: 'Copied the last range only: ranges must share rows or columns',
    keepMine: 'Keep my value', useTheirs: value => `Use latest value${value ? ` (${value})` : ''}`,
    conflictTitle: theirs => `Changed elsewhere to "${theirs}" while you were editing. Right-click to resolve.`,
    applyToAll: (shortcut, count) => `${shortcut} applies to all ${count.toLocaleString()} selected cells`,
    applyingToAll: count => `Applies to all ${count.toLocaleString()} selected cells`,
    findOption: 'Find an option', openOptions: column => `Open ${column} options`, removeOption: label => `Remove ${label}`, originalValue: 'Before', createOption: text => `Add "${text}"`, noMatchingOption: 'No matching option', multiSelectHint: 'Enter toggles · Tab to finish',
    filterWhere: 'Where', filterAnd: 'and', noFilters: 'No filters. Rows matching every condition are shown.',
    addCondition: '+ Add condition', chooseOption: 'Choose…', value: 'Value', sortBy: 'Sort by', thenBy: 'then by',
    noSorting: 'No sorting. Rows keep their original order.', ascending: 'Ascending', descending: 'Descending',
    addSort: '+ Add sort', removeCondition: 'Remove', sortAscending: 'Sorted ascending', sortDescending: 'Sorted descending',
    sortState: (column, direction, priority) => `${column} sorted ${direction === 'asc' ? 'ascending' : 'descending'}${priority ? ` (sort ${priority})` : ''}`,
    bulkTitle: count => `Edit ${count.toLocaleString()} selected cells`, keepUnchanged: 'Keep unchanged',
    chooseWhat: 'Choose what to change.', fixInputs: 'Fix the highlighted inputs.',
    willChange: count => `${plural(count, 'cell')} will change`, alreadyMatch: count => `${count.toLocaleString()} already match`,
    skippedReason: (count, reason) => `${count.toLocaleString()} skipped: ${reason}`,
    applyHint: (apply, undo) => `${apply} to apply · undo with ${undo}`, cancel: 'Cancel', apply: 'Apply',
    changeCells: count => `Change ${plural(count, 'cell')}`, emptyValue: '(empty)', newValue: 'New value',
    checked: 'Checked', unchecked: 'Unchecked', dropToUpload: 'Drop to upload',
    uploadFailed: error => `Upload failed: ${error}`, notAccepted: column => `${column} does not accept these files`,
  },
  image: {
    notImageUrl: 'Not an image URL', onlyOne: 'Only one image', atMost: count => `At most ${count} images`,
    noImages: 'No image files', chooseImage: 'Choose an image file',
    onlyMoreFit: count => `Only ${count} more ${count === 1 ? 'image fits' : 'images fit'}`,
    waitForUpload: 'Wait for the upload to finish', add: 'Add', replace: 'Replace', remove: index => `Remove image ${index}`,
    uploading: 'Uploading', urlPlaceholder: 'Paste an image URL and press Enter', dropOrPaste: 'Drop or paste images',
    done: 'Done', countAtLeast: 'has at least (images)',
  },
}

export type MessagesInput = { [K in keyof Messages]?: Messages[K] extends string ? string : Partial<Messages[K]> }

const merged = new WeakMap<object, Messages>()

/** English defaults with the given overrides; the same input object returns the same result. */
export function resolveMessages(input?: MessagesInput): Messages {
  if (!input) return en
  const cached = merged.get(input)
  if (cached) return cached
  const result = {
    locale: input.locale ?? en.locale,
    errors: { ...en.errors, ...input.errors },
    filters: { ...en.filters, ...input.filters },
    bulk: { ...en.bulk, ...input.bulk },
    quick: { ...en.quick, ...input.quick },
    ui: { ...en.ui, ...input.ui },
    image: { ...en.image, ...input.image },
  } as Messages
  merged.set(input, result)
  return result
}
