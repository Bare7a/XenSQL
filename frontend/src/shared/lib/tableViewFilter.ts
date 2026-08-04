// useTabOpener dispatches; the addressed TableViewPane listens and refetches, since it owns the fetch.
export const TABLE_VIEW_FILTER_EVENT = 'xensql:table-view-filter';

export interface TableViewFilterDetail {
  tabId: string;
  filter: string;
}

export function requestTableViewFilter(tabId: string, filter: string): void {
  window.dispatchEvent(new CustomEvent<TableViewFilterDetail>(TABLE_VIEW_FILTER_EVENT, { detail: { tabId, filter } }));
}
