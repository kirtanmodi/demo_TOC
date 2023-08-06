const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({ region: 'ap-south-1' });
const tableName = 'demo-toc-config-values';

exports.handler = async (event) => {
  try {
    const fieldName = event.fieldName; 
    const fieldValues = await fetchConfigValues(fieldName);

    if (fieldValues) {
      return {
        statusCode: 200,
        body: JSON.stringify(fieldValues),
      };
    } else {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: 'Field name not found in config values.' }),
      };
    }
  } catch (error) {
    console.error('Error fetching config values:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error.' }),
    };
  }
};

const fetchConfigValues = async (fieldName) => {
  try {
    const queryParams = {
      TableName: tableName,
      Key: { value: fieldName },
    };

    const data = await client.send(new GetItemCommand(queryParams));
    return data.Item ? data.Item.data : null;
  } catch (error) {
    console.error('Error fetching config values:', error);
    throw error;
  }
};
