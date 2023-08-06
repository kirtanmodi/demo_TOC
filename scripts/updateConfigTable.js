const AWS = require('aws-sdk');
const configValues = require('../configValues');


AWS.config.update({ region: 'ap-south-1' });

const docClient = new AWS.DynamoDB.DocumentClient();
const tableName = 'demo-toc-config-values';


const updateConfigValues = async () => {

  console.log('tableName:', tableName);
  try {
    for (const fieldName in configValues) {
      const fieldValues = configValues[fieldName];
      const existingFieldValues = await fetchConfigValues(fieldName);


      if (!existingFieldValues || JSON.stringify(existingFieldValues) !== JSON.stringify(fieldValues)) {
        const updateParams = {
          TableName: tableName,
          Key: { value: fieldName },
          UpdateExpression: 'SET #data = :fieldValues',
          ExpressionAttributeNames: { '#data': 'data' },
          ExpressionAttributeValues: { ':fieldValues': fieldValues },
        };

        await docClient.update(updateParams).promise();
        console.log(`Config values for ${fieldName} updated successfully.`);
      } else {
        console.log(`Config values for ${fieldName} are already up to date. Skipping update.`);
      }
    }

    console.log('All config values updated successfully.');
  } catch (error) {
    console.error('Error updating config values:', error);
    throw error;
  }
};

const fetchConfigValues = async (fieldName) => {
  const queryParams = {
    TableName: tableName,
    Key: { value: fieldName },
  };

  const data = await docClient.get(queryParams).promise();
  return data.Item ? data.Item.data : null;
};

module.exports = updateConfigValues();