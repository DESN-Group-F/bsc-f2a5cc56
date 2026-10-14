export const TEMPLATE_PATHS = Object.freeze(['/templates/batteries.csv', '/templates/buildings.csv', '/templates/people.csv', '/templates/rooms.csv']);

export async function downloadImportTemplate(path, content, save) {
  if (!TEMPLATE_PATHS.includes(path) || typeof content !== 'string' || !content.trim()) throw new Error('This import template is unavailable.');
  await save({ filename: path.slice('/templates/'.length), blob: new Blob([content], { type: 'text/csv;charset=utf-8' }) });
}
