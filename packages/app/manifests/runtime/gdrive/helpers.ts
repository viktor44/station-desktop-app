import ElectronGoogleOAuth2 from '@getstation/electron-google-oauth2';
import { SDK, search, tabs } from '@getstation/sdk';
import { drive as driveApi, drive_v3 } from '@googleapis/drive';
import { oauth2 as oauth2Api, oauth2_v2 } from '@googleapis/oauth2';
import memoizee = require('memoizee');

import { idExtractor } from './activity';

type Schema$File = drive_v3.Schema$File;
type Schema$FileList = drive_v3.Schema$FileList;
// `Schema$Userinfoplus` in the old monolithic `googleapis` package
type Schema$Userinfoplus = oauth2_v2.Schema$Userinfo;

const drive = driveApi('v3');
const isBlankRegex = /^\s*$/;

export class ElectronGDriveOAuth2 extends ElectronGoogleOAuth2 {

  constructor(clientId: string, clientSecret: string) {
    super(
      clientId,
      clientSecret,
      ['https://www.googleapis.com/auth/drive.metadata.readonly', 'https://www.googleapis.com/auth/userinfo.profile']
    );

    this.getFile = memoizee(this.getFile.bind(this), { maxAge: 15000 });
    this.getUserInfos = memoizee(this.getUserInfos.bind(this), { maxAge: 15000 });
  }

  async listFiles(query: string) {
    if (query.match(isBlankRegex)) return [] as Schema$File[];
    // Reference: https://developers.google.com/drive/v3/reference/files/list
    // All files properties: https://developers.google.com/drive/v3/reference/files#resource

    const response = await drive.files.list({
      pageSize: 10,
      auth: this.oauth2Client,
      orderBy: 'viewedByMeTime desc',
      supportsTeamDrives: true,
      includeTeamDriveItems: true,
      fields: 'files(kind,id,name,mimeType,webViewLink,iconLink)',
      q: `name contains '${query}'`,
    });
    return (response.data as Schema$FileList).files;
  }

  async getUserInfos(): Promise<Schema$Userinfoplus> {
    // The callback overload this used to pass was typed against `AxiosPromise`,
    // which never matched the library's `BodyResponseCallback`; the promise
    // overload issues the same request and rejects on the same errors.
    const response = await oauth2Api({
      auth: this.oauth2Client,
      version: 'v2',
    }).userinfo.get();

    return response.data;
  }

  async getFile(fileId: string): Promise<Schema$File & { email: string }> {
    const file = await drive.files.get({
      auth: this.oauth2Client,
      fileId,
      fields: 'kind,id,name,mimeType,webViewLink,iconLink',
    });

    const { email } = await this.getUserInfos();

    return { ...file.data as Schema$File, email: email! };
  }
}

export function getGDriveFileAsSearchResult(sdk: SDK, item: Schema$File, accountLabel?: string): search.SearchResultItem {
  const matchingTab = sdk.tabs
    .getTabs()
    .find((t: tabs.Tab) => idExtractor(t.url) === item.id);

  const onSelect = matchingTab ?
    async () => await sdk.tabs.navToTab(matchingTab.tabId) :
    undefined;

  // Every field asserted below is in the `fields` projection of the Drive
  // requests above, so the API always populates it. The old import of these
  // schemas resolved to `any`, which is why the assertions were not needed
  // before.
  return {
    resourceId: item.id!,
    category: !accountLabel ? 'Google Drive' : `Google Drive - ${accountLabel}`,
    label: item.name!,
    context: accountLabel,
    imgUrl: item.iconLink!,
    manifestURL: sdk.search.id,
    onSelect,
    url: item.webViewLink!,
  };
}

export function getGDriveFilesAsSearchResults(sdk: SDK, files: Schema$File[], accountLabel?: string): search.SearchResultWrapper {
  /**
   * Sample of what an item in searchResult looks like
   * { kind: 'drive#file',
     * id: '1ZBomcyRF0reGagZorrWesRgoQ8YMnBt8cHrgaLRsrro',
     * name: 'Station\'s users export - September 2017 V2.csv',
     * mimeType: 'application/vnd.google-apps.spreadsheet',
     * webViewLink: 'https://docs.google.com/spreadsheets/d/1ZBomcyRF0reGagZorrWesRgoQ8YMnBt8cHrgaLRsrro/edit?usp=drivesdk',
     * iconLink: 'https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.google-apps.spreadsheet' }
   */
  return {
    results: files.map(
      file => getGDriveFileAsSearchResult(sdk, file, accountLabel)),
  };
}
