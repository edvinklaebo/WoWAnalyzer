import { blizzardApiResponseLatencyHistogram } from 'helpers/metrics';
import RequestTimeoutError from 'helpers/request/RequestTimeoutError';
import RequestSocketTimeoutError from 'helpers/request/RequestSocketTimeoutError';
import RequestConnectionResetError from 'helpers/request/RequestConnectionResetError';
import RequestUnknownError from 'helpers/request/RequestUnknownError';
import retryingRequest from './retryingRequest';

const availableRegions = {
  eu: 'ru_RU',
  us: 'en_US',
  tw: 'zh_TW',
  kr: 'ko_KR',
};

const USER_AGENT = process.env.USER_AGENT;
const clientToken = {};

const get = (url, metricLabels, region, accessToken) => {
  let end;
  return retryingRequest({
    url,
    headers: {
      'User-Agent': USER_AGENT,
    },
    gzip: true,
    // we'll be making several requests, so pool connections
    forever: true,
    timeout: 4000, // ms after which to abort the request, when a character is uncached it's not uncommon to take ~2sec
    shouldRetry: error => {
      const { statusCode } = error;
      //generally 404 should probably just not be retried
      return statusCode !== 404;
    },
    onBeforeAttempt: () => {
      end = blizzardApiResponseLatencyHistogram.startTimer(metricLabels);
    },
    onFailure: async err => {
      if (err.statusCode === 401) {
        // if the request in unauthorized, try renewing
        // the battle net creds
        delete clientToken[region];
        getAccessToken(region);
        end({
          statusCode: 401,
        });
      } else if (err instanceof RequestTimeoutError) {
        end({
          statusCode: 'timeout',
        });
      } else if (err instanceof RequestSocketTimeoutError) {
        end({
          statusCode: 'socket timeout',
        });
      } else if (err instanceof RequestConnectionResetError) {
        end({
          statusCode: 'connection reset',
        });
      } else if (err instanceof RequestUnknownError) {
        end({
          statusCode: 'unknown',
        });
      } else {
        end({
          statusCode: err.statusCode,
        });
      }
      return null;
    },
    onSuccess: () => {
      end({
        statusCode: 200,
      });
    },
  });
};
const makeBaseUrl = region => `https://${region}.api.blizzard.com`;

const getAccessToken = async region => {
  let end;
  const now = new Date();
  if (clientToken[region] && clientToken[region].accessToken && clientToken[region].expires > now) {
    return clientToken[region].accessToken;
  }

  const url = `https://${region}.battle.net/oauth/token?grant_type=client_credentials&client_id=${process.env.BATTLE_NET_API_CLIENT_ID}&client_secret=${
    process.env.BATTLE_NET_API_CLIENT_SECRET
  }`;

  const tokenRequest = await retryingRequest({
    url,
    headers: {
      'User-Agent': USER_AGENT,
    },
    gzip: true,
    // we'll be making several requests, so pool connections
    forever: true,
    timeout: 4000,
    shouldRetry: error => {
      return error.statusCode !== 404;
    },
    onBeforeAttempt: () => {
      end = blizzardApiResponseLatencyHistogram.startTimer({
        category: 'token',
        region,
      });
    },
    onFailure: err => {
      if (err instanceof RequestTimeoutError) {
        end({
          statusCode: 'timeout',
        });
      } else if (err instanceof RequestSocketTimeoutError) {
        end({
          statusCode: 'socket timeout',
        });
      } else if (err instanceof RequestConnectionResetError) {
        end({
          statusCode: 'connection reset',
        });
      } else if (err instanceof RequestUnknownError) {
        end({
          statusCode: 'unknown',
        });
      } else {
        end({
          statusCode: err.statusCode,
        });
      }
    },
    onSuccess: () => {
      end({
        statusCode: 200,
      });
    },
  });

  const tokenData = JSON.parse(tokenRequst);
  const expireDate = now.setSeconds(now.getSeconds() + tokenData.expires_in);

  clientToken[region] = {
    accessToken: tokenData.access_token,
    expires: expireDate,
  };

  return clientToken[region].accessToken;
};

export async function fetchCharacter(region, realm, name, fields = '') {
  region = region.toLowerCase();
  if (!availableRegions[region]) {
    throw new Error('Region not recognized.');
  }
  const accessToken = await getAccessToken(region);
  const url = `${makeBaseUrl(region)}/wow/character/${encodeURIComponent(realm)}/${encodeURIComponent(name)}?locale=${availableRegions[region]}&fields=${fields}`;

  return get(
    url,
    {
      category: 'character',
      region,
    },
    region,
    accessToken,
  );
}

export async function fetchItem(region, itemId) {
  region = region.toLowerCase();
  if (!availableRegions[region]) {
    throw new Error('Region not recognized.');
  }
  const accessToken = await getAccessToken(region);
  const url = `${makeBaseUrl(region)}/wow/item/${encodeURIComponent(itemId)}?locale=${availableRegions[region]}`;

  return get(
    url,
    {
      category: 'item',
      region,
    },
    region,
    accessToken,
  );
}

export async function fetchSpell(region, spellId) {
  region = region.toLowerCase();
  if (!availableRegions[region]) {
    throw new Error('Region not recognized.');
  }
  const accessToken = await getAccessToken(region);
  const url = `${makeBaseUrl(region)}/wow/spell/${encodeURIComponent(spellId)}?locale=${availableRegions[region]}`;

  return get(
    url,
    {
      category: 'spell',
      region,
    },
    region,
    accessToken,
  );
}
