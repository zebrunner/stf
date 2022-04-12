const fs = require('fs');

const extractValue = (str) => {
    return (str.match(/^<.{1,}>(.{1,})<\/.{1,}>$/))[1];
}

const formNode = (obj, data, startIndex) => {
    const key = extractValue(data[startIndex]);
    let valueLine = data[startIndex + 1];
    if (valueLine.startsWith("<string>") || valueLine.startsWith("<integer>") || valueLine.startsWith("<real>") || valueLine.startsWith("<date>") || valueLine.startsWith("<data>")) {
        obj[key] = extractValue(valueLine);
        return;
    }
    if (valueLine.startsWith("<array>")) {
        obj[key] = [];
        let newIndex = startIndex + 2;
        while (data[newIndex] != "</array>") {
            obj[key].push(extractValue(data[newIndex]));
            newIndex++;
        };
        return;
    }
    if (valueLine == "<true/>") {
        obj[key] = true;
        return;
    }

    if (valueLine == "<false/>") {
        obj[key] = false;
        return;
    }

    console.error("Cant define type of: " + valueLine)
    return;
}

const xmlToJson = (data) => {
    let counter = 0;
    const cleanedData = (data.replace(/\t/g, "").split(/<\/?dict>/).filter(el => el).map(el => el.trim()))[1].split(/\n/g);
    let l = cleanedData.length;
    let result = {};
    for (let i = 0; i < l; i++) {
        if (cleanedData[i].startsWith("<key>")) {
            formNode(result, cleanedData, i);
        }
    }
    return JSON.stringify(result);
} 

const fileParser = (filename) => {
    return new Promise((resolve, reject) => {
        fs.readFile(`${filename}`, 'utf8', (err, data) => {
            if (err) return reject(err);
            resolve(xmlToJson(data));
          })
      })
}

module.exports = function(filepath) {
    return fileParser(filepath)
}